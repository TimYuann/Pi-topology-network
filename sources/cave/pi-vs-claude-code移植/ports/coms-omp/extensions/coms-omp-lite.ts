/**
 * coms-omp-lite - minimal local peer messaging for OMP smoke tests.
 *
 * This entrypoint intentionally avoids @oh-my-pi/pi-tui and runtime imports
 * from @oh-my-pi/pi-coding-agent. The full port keeps the live widget and rich
 * renderers in coms-omp.ts; this file keeps only the transport surface needed
 * for first-round ekunAi smoke testing.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";

const COMS_DIR = process.env.OMP_COMS_DIR || path.join(os.homedir(), ".omp", "coms");
const MAX_HOPS = Number(process.env.OMP_COMS_MAX_HOPS) || 5;
const TIMEOUT_MS = Number(process.env.OMP_COMS_TIMEOUT_MS) || 1_800_000;
const KEEPALIVE_INTERVAL_MS = 30_000;
const LINE_CAP_BYTES = 64 * 1024;

const FALLBACK_PALETTE = [
	"#72F1B8", "#36F9F6", "#FF7EDB", "#FEDE5D",
	"#C792EA", "#FF8B39", "#4D9DE0", "#FFAA8B",
];

type EnvelopeType = "prompt" | "response" | "ping";

interface Envelope {
	type: EnvelopeType;
	msg_id: string;
	sender_session: string;
	sender_endpoint: string;
	hops: number;
	timestamp: string;
}

interface PromptEnvelope extends Envelope {
	type: "prompt";
	prompt: string;
	sender_name: string;
	sender_cwd: string;
	conversation_id?: string | null;
	response_schema?: object | null;
}

interface ResponseEnvelope extends Envelope {
	type: "response";
	response: unknown;
	error?: string | null;
}

interface PingEnvelope extends Envelope {
	type: "ping";
}

interface AgentCard {
	name: string;
	purpose: string;
	model: string;
	color: string;
	context_used_pct: number;
	queue_depth: number;
}

interface RegistryEntry {
	session_id: string;
	name: string;
	purpose: string;
	model: string;
	color: string;
	pid: number;
	endpoint: string;
	cwd: string;
	started_at: string;
	explicit: boolean;
	version: number;
	context_used_pct?: number;
	queue_depth?: number;
	heartbeat_at?: string;
}

interface PendingReply {
	resolve: (value: { response?: unknown; error?: string | null }) => void;
	timer: NodeJS.Timeout | null;
	promise: Promise<{ response?: unknown; error?: string | null }>;
	result?: { response?: unknown; error?: string | null };
	target_name?: string;
	created_at: string;
}

interface InboundContext {
	msg_id: string;
	hops: number;
	sender_endpoint: string;
	sender_session: string;
	response_schema?: object | null;
	fulfilled: boolean;
}

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function ulid(): string {
	const time = Date.now();
	const rand = crypto.randomBytes(10);
	let timeStr = "";
	let t = time;
	for (let i = 9; i >= 0; i--) {
		timeStr = CROCKFORD[t % 32] + timeStr;
		t = Math.floor(t / 32);
	}
	let randStr = "";
	let bits = 0;
	let value = 0;
	for (const byte of rand) {
		value = (value << 8) | byte;
		bits += 8;
		while (bits >= 5) {
			bits -= 5;
			randStr += CROCKFORD[(value >> bits) & 31];
		}
	}
	return (timeStr + randStr).slice(0, 26);
}

function nowIso(): string {
	return new Date().toISOString();
}

function fallbackColor(sessionId: string): string {
	const h = crypto.createHash("sha256").update(sessionId).digest("hex").slice(0, 8);
	return FALLBACK_PALETTE[Number(BigInt("0x" + h)) % FALLBACK_PALETTE.length];
}

function isValidHex(hex: string): boolean {
	return /^#[0-9a-fA-F]{6}$/.test(hex);
}

function makeEndpoint(sessionId: string): string {
	if (process.platform === "win32") {
		return `\\\\.\\pipe\\omp-coms-${sessionId}`;
	}
	return path.join(COMS_DIR, "sockets", `${sessionId}.sock`);
}

function projectAgentsDir(project: string): string {
	return path.join(COMS_DIR, "projects", project, "agents");
}

function registryFilePath(project: string, name: string): string {
	return path.join(projectAgentsDir(project), `${name}.json`);
}

function writeRegistryAtomic(entry: RegistryEntry, project: string): string {
	const dir = projectAgentsDir(project);
	fs.mkdirSync(dir, { recursive: true });
	const final = registryFilePath(project, entry.name);
	const tmp = `${final}.tmp`;
	fs.writeFileSync(tmp, JSON.stringify(entry, null, 2));
	fs.renameSync(tmp, final);
	return final;
}

function removeRegistryEntry(project: string, name: string): void {
	try {
		fs.unlinkSync(registryFilePath(project, name));
	} catch {
		// best effort
	}
}

function readAllRegistryEntries(project: string): RegistryEntry[] {
	const dir = projectAgentsDir(project);
	if (!fs.existsSync(dir)) return [];
	const out: RegistryEntry[] = [];
	for (const file of fs.readdirSync(dir)) {
		if (!file.endsWith(".json")) continue;
		try {
			const parsed = JSON.parse(fs.readFileSync(path.join(dir, file), "utf-8"));
			if (parsed && typeof parsed.session_id === "string" && typeof parsed.endpoint === "string") {
				out.push(parsed);
			}
		} catch {
			// ignore corrupt or half-written entries
		}
	}
	return out;
}

function listProjects(): string[] {
	const root = path.join(COMS_DIR, "projects");
	try {
		return fs.readdirSync(root).filter((name) => {
			try {
				return fs.statSync(path.join(root, name)).isDirectory();
			} catch {
				return false;
			}
		});
	} catch {
		return [];
	}
}

function isPidAlive(pid: number): boolean {
	if (!pid || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

function pruneDeadEntries(project: string): RegistryEntry[] {
	const live: RegistryEntry[] = [];
	for (const entry of readAllRegistryEntries(project)) {
		if (isPidAlive(entry.pid)) {
			live.push(entry);
		} else {
			removeRegistryEntry(project, entry.name);
		}
	}
	return live;
}

function resolveUniqueName(project: string, desiredName: string): string {
	const existing = new Set(readAllRegistryEntries(project).map((e) => e.name));
	if (!existing.has(desiredName)) return desiredName;
	for (let i = 2; i < 1000; i++) {
		const candidate = `${desiredName}-${i}`;
		if (!existing.has(candidate)) return candidate;
	}
	return `${desiredName}-${ulid().slice(-6)}`;
}

function sendEnvelope(endpoint: string, env: Envelope): Promise<any> {
	return new Promise((resolve, reject) => {
		const socket = net.createConnection(endpoint);
		let buf = "";
		let settled = false;
		const timeout = setTimeout(() => {
			if (settled) return;
			settled = true;
			try { socket.destroy(); } catch { /* ignore */ }
			reject(new Error("timeout"));
		}, 15_000);
		try { (timeout as any).unref?.(); } catch { /* ignore */ }

		function finish(err: Error | null, value?: any) {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			try { socket.end(); } catch { /* ignore */ }
			if (err) reject(err);
			else resolve(value);
		}

		socket.on("connect", () => {
			socket.write(JSON.stringify(env) + "\n");
		});
		socket.on("data", (chunk) => {
			buf += chunk.toString("utf-8");
			if (buf.length > LINE_CAP_BYTES) {
				finish(new Error("oversized response"));
				return;
			}
			const nl = buf.indexOf("\n");
			if (nl < 0) return;
			let parsed: any;
			try {
				parsed = JSON.parse(buf.slice(0, nl));
			} catch {
				finish(new Error("malformed response"));
				return;
			}
			if (parsed.type === "nack") {
				finish(new Error(parsed.error || "nack"));
				return;
			}
			finish(null, parsed);
		});
		socket.on("error", (err) => finish(err));
	});
}

function getFlag(pi: any, name: string): unknown {
	try {
		return pi.getFlag(name);
	} catch {
		return undefined;
	}
}

function notify(ctx: any, message: string, level: "info" | "error" = "info"): void {
	try {
		ctx?.ui?.notify?.(message, level);
	} catch {
		// no UI
	}
}

function getAssistantText(ctx: any): string {
	let lastAssistantText = "";
	try {
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type !== "message" || entry.message.role !== "assistant") continue;
			const content = entry.message.content;
			if (typeof content === "string") {
				lastAssistantText = content;
			} else if (Array.isArray(content)) {
				lastAssistantText = content
					.filter((block: any) => block && block.type === "text")
					.map((block: any) => block.text)
					.join("\n");
			}
		}
	} catch {
		// session branch shape is not guaranteed across OMP versions
	}
	return lastAssistantText;
}

export default function comsOmpLite(pi: any) {
	const { Type } = pi.typebox;

	pi.registerFlag("cname", {
		description: "Override coms agent name. Distinct from OMP/harness --name.",
		type: "string",
		default: undefined,
	});
	pi.registerFlag("purpose", {
		description: "Override agent purpose.",
		type: "string",
		default: undefined,
	});
	pi.registerFlag("project", {
		description: "Project namespace for peer discovery.",
		type: "string",
		default: "default",
	});
	pi.registerFlag("color", {
		description: "Hex color #RRGGBB.",
		type: "string",
		default: undefined,
	});
	pi.registerFlag("explicit", {
		description: "Hide this agent from default discovery.",
		type: "boolean",
		default: false,
	});

	let identity: {
		session_id: string;
		name: string;
		purpose: string;
		color: string;
		project: string;
		explicit: boolean;
		cwd: string;
		model: string;
		endpoint: string;
		registryFile: string;
	} | null = null;
	const pendingReplies = new Map<string, PendingReply>();
	const inboundQueue = new Map<string, InboundContext>();
	let currentInbound: InboundContext | null = null;
	let server: net.Server | null = null;
	let keepaliveTimer: NodeJS.Timeout | null = null;

	function ackOk(socket: net.Socket, msg_id: string): void {
		try {
			socket.write(JSON.stringify({ type: "ack", msg_id }) + "\n");
		} catch {
			// ignore
		}
		try { socket.end(); } catch { /* ignore */ }
	}

	function nack(socket: net.Socket, msg_id: string, error: string): void {
		try {
			socket.write(JSON.stringify({ type: "nack", msg_id, error }) + "\n");
		} catch {
			// ignore
		}
		try { socket.end(); } catch { /* ignore */ }
	}

	function handlePrompt(socket: net.Socket, env: PromptEnvelope): void {
		if (typeof env.hops !== "number" || env.hops >= MAX_HOPS) {
			nack(socket, env.msg_id, "hops exceeded");
			return;
		}
		const inbound: InboundContext = {
			msg_id: env.msg_id,
			hops: env.hops,
			sender_endpoint: env.sender_endpoint,
			sender_session: env.sender_session,
			response_schema: env.response_schema ?? null,
			fulfilled: false,
		};
		inboundQueue.set(env.msg_id, inbound);
		currentInbound = inbound;
		try {
			pi.sendMessage(
				{
					customType: "coms-inbound",
					content: `[from ${env.sender_name} @ ${env.sender_cwd}]\n\n${env.prompt}`,
					display: true,
					details: {
						msg_id: env.msg_id,
						sender_session: env.sender_session,
						response_schema: env.response_schema ?? null,
					},
				},
				{ deliverAs: "followUp", triggerTurn: true },
			);
		} catch {
			inboundQueue.delete(env.msg_id);
			currentInbound = null;
			nack(socket, env.msg_id, "internal error");
			return;
		}
		ackOk(socket, env.msg_id);
	}

	function handleResponse(socket: net.Socket, env: ResponseEnvelope): void {
		const pending = pendingReplies.get(env.msg_id);
		if (pending) {
			if (pending.timer) {
				clearTimeout(pending.timer);
				pending.timer = null;
			}
			pending.result = { response: env.response, error: env.error ?? null };
			pending.resolve(pending.result);
		}
		ackOk(socket, env.msg_id);
	}

	function handlePing(socket: net.Socket, env: PingEnvelope): void {
		const card: AgentCard = {
			name: identity?.name ?? "unknown",
			purpose: identity?.purpose ?? "",
			model: identity?.model ?? "unknown",
			color: identity?.color ?? "#36F9F6",
			context_used_pct: 0,
			queue_depth: inboundQueue.size,
		};
		try {
			socket.write(JSON.stringify({ type: "pong", msg_id: env.msg_id, agent_card: card }) + "\n");
		} catch {
			// ignore
		}
		try { socket.end(); } catch { /* ignore */ }
	}

	function connHandler(socket: net.Socket): void {
		let buf = "";
		let handled = false;
		const onData = (chunk: Buffer) => {
			if (handled) return;
			buf += chunk.toString("utf-8");
			if (buf.length > LINE_CAP_BYTES) {
				handled = true;
				socket.removeListener("data", onData);
				nack(socket, "", "malformed envelope");
				return;
			}
			const nl = buf.indexOf("\n");
			if (nl < 0) return;
			handled = true;
			socket.removeListener("data", onData);
			let parsed: any;
			try {
				parsed = JSON.parse(buf.slice(0, nl));
			} catch {
				nack(socket, "", "malformed envelope");
				return;
			}
			if (!parsed || typeof parsed.type !== "string" || typeof parsed.msg_id !== "string") {
				nack(socket, "", "malformed envelope");
				return;
			}
			if (parsed.type === "prompt") handlePrompt(socket, parsed);
			else if (parsed.type === "response") handleResponse(socket, parsed);
			else if (parsed.type === "ping") handlePing(socket, parsed);
			else nack(socket, parsed.msg_id, "unknown type");
		};
		socket.on("data", onData);
		socket.once("error", () => {
			try { socket.destroy(); } catch { /* ignore */ }
		});
	}

	pi.on("session_start", async (_event: unknown, ctx: any) => {
		const project = (getFlag(pi, "project") as string | undefined) || "default";
		const explicit = getFlag(pi, "explicit") === true;
		const session_id = ulid();
		const desiredName = (getFlag(pi, "cname") as string | undefined) || `agent-${session_id.slice(-6)}`;
		const name = resolveUniqueName(project, desiredName);
		const purpose = (getFlag(pi, "purpose") as string | undefined) || "";
		const flagColor = getFlag(pi, "color") as string | undefined;
		const color = flagColor && isValidHex(flagColor) ? flagColor : fallbackColor(session_id);
		const endpoint = makeEndpoint(session_id);
		const cwd = ctx?.cwd || process.cwd();
		const model = ctx?.model?.id ?? "unknown";

		try {
			fs.mkdirSync(projectAgentsDir(project), { recursive: true });
			if (process.platform !== "win32") fs.mkdirSync(path.join(COMS_DIR, "sockets"), { recursive: true });
			if (process.platform !== "win32") {
				try { fs.unlinkSync(endpoint); } catch { /* ignore stale or missing socket */ }
			}
			server = await new Promise<net.Server>((resolve, reject) => {
				const srv = net.createServer(connHandler);
				srv.once("error", reject);
				srv.listen(endpoint, () => {
					srv.off("error", reject);
					resolve(srv);
				});
			});
			if (process.platform !== "win32") {
				try { fs.chmodSync(endpoint, 0o600); } catch { /* best effort */ }
			}
		} catch (err) {
			notify(ctx, `coms-lite: bind failed - ${err instanceof Error ? err.message : String(err)}`, "error");
			return;
		}

		const entry: RegistryEntry = {
			session_id,
			name,
			purpose,
			model,
			color,
			pid: process.pid,
			endpoint,
			cwd,
			started_at: nowIso(),
			explicit,
			version: 1,
		};
		const registryFile = writeRegistryAtomic(entry, project);
		identity = { session_id, name, purpose, color, project, explicit, cwd, model, endpoint, registryFile };
		try { pi.appendEntry("coms-log", { event: "boot", session_id, name, project, lite: true }); } catch { /* ignore */ }
		try { ctx?.ui?.setStatus?.("coms", `coms ${name}@${project}`); } catch { /* no UI */ }
		notify(ctx, `coms-lite ready: ${name}@${project}`, "info");

		keepaliveTimer = setInterval(() => {
			if (!identity) return;
			try {
				writeRegistryAtomic({
					session_id: identity.session_id,
					name: identity.name,
					purpose: identity.purpose,
					model: identity.model,
					color: identity.color,
					pid: process.pid,
					endpoint: identity.endpoint,
					cwd: identity.cwd,
					started_at: nowIso(),
					explicit: identity.explicit,
					version: 1,
					queue_depth: inboundQueue.size,
					heartbeat_at: nowIso(),
				}, identity.project);
			} catch {
				// keepalive is best effort
			}
		}, KEEPALIVE_INTERVAL_MS);
		try { (keepaliveTimer as any).unref?.(); } catch { /* ignore */ }
	});

	function resolveTarget(target: string): RegistryEntry | null {
		if (identity) {
			const local = pruneDeadEntries(identity.project).find((entry) => entry.name === target);
			if (local) return local;
		}
		for (const project of listProjects()) {
			const bySession = pruneDeadEntries(project).find((entry) => entry.session_id === target);
			if (bySession) return bySession;
		}
		for (const project of listProjects()) {
			const byName = pruneDeadEntries(project).find((entry) => entry.name === target);
			if (byName) return byName;
		}
		return null;
	}

	async function pingPeer(entry: RegistryEntry): Promise<AgentCard | null> {
		if (!identity) return null;
		try {
			const reply = await sendEnvelope(entry.endpoint, {
				type: "ping",
				msg_id: ulid(),
				sender_session: identity.session_id,
				sender_endpoint: identity.endpoint,
				hops: 0,
				timestamp: nowIso(),
			});
			if (reply?.type === "pong" && reply.agent_card) return reply.agent_card;
		} catch {
			// unreachable peers are reported as not alive
		}
		return null;
	}

	pi.registerTool({
		name: "coms_list",
		label: "Coms List",
		description: "List peer agents discoverable via local coms.",
		parameters: Type.Object({
			project: Type.Optional(Type.String({ description: "Project name, or * for all projects." })),
			include_explicit: Type.Optional(Type.Boolean({ description: "Include agents launched with --explicit." })),
		}),
		async execute(_callId: string, params: any) {
			const projectFilter = params.project ?? identity?.project ?? "default";
			const projects = projectFilter === "*" ? listProjects() : [projectFilter];
			const includeExplicit = params.include_explicit === true;
			const entries: Array<{ entry: RegistryEntry; project: string }> = [];
			for (const project of projects) {
				for (const entry of pruneDeadEntries(project)) {
					if (identity && entry.session_id === identity.session_id) continue;
					if (entry.explicit && !includeExplicit) continue;
					entries.push({ entry, project });
				}
			}
			const pongs = await Promise.allSettled(entries.map(({ entry }) => pingPeer(entry)));
			const agents = entries.map(({ entry, project }, index) => {
				const pong = pongs[index].status === "fulfilled" ? pongs[index].value : null;
				return {
					name: entry.name,
					session_id: entry.session_id,
					purpose: entry.purpose,
					model: entry.model,
					cwd: entry.cwd,
					project,
					alive: pong != null,
					context_used_pct: pong?.context_used_pct ?? entry.context_used_pct ?? null,
					color: entry.color,
				};
			});
			const lines = agents.length === 0
				? "No peer agents found."
				: agents.map((agent) => `${agent.alive ? "live" : "stale"} ${agent.name} (${agent.model}) ${agent.purpose}`.trim()).join("\n");
			return {
				content: [{ type: "text" as const, text: `${agents.length} peer(s):\n${lines}` }],
				details: { agents, project: projectFilter },
			};
		},
	});

	pi.registerTool({
		name: "coms_send",
		label: "Coms Send",
		description: "Send a prompt to a peer agent and return a msg_id for coms_get/coms_await.",
		parameters: Type.Object({
			target: Type.String({ description: "Peer name or session_id." }),
			prompt: Type.String({ description: "Prompt to send." }),
			conversation_id: Type.Optional(Type.String()),
			response_schema: Type.Optional(Type.Any()),
		}),
		async execute(_callId: string, params: any) {
			if (!identity) throw new Error("coms not initialised");
			const target = resolveTarget(params.target);
			if (!target) throw new Error(`coms: no live agent matching "${params.target}"`);
			const hops = currentInbound ? currentInbound.hops + 1 : 0;
			if (hops >= MAX_HOPS) throw new Error(`coms: hop limit reached (${hops} >= ${MAX_HOPS})`);
			const msg_id = ulid();
			await sendEnvelope(target.endpoint, {
				type: "prompt",
				msg_id,
				sender_session: identity.session_id,
				sender_endpoint: identity.endpoint,
				sender_name: identity.name,
				sender_cwd: identity.cwd,
				hops,
				timestamp: nowIso(),
				prompt: params.prompt,
				conversation_id: params.conversation_id ?? null,
				response_schema: params.response_schema ?? null,
			});
			let resolveFn!: (value: { response?: unknown; error?: string | null }) => void;
			const promise = new Promise<{ response?: unknown; error?: string | null }>((resolve) => {
				resolveFn = resolve;
			});
			const pending: PendingReply = {
				resolve: resolveFn,
				timer: null,
				promise,
				target_name: target.name,
				created_at: nowIso(),
			};
			pending.timer = setTimeout(() => {
				if (pending.result) return;
				pending.result = { error: "timeout" };
				pending.resolve(pending.result);
			}, TIMEOUT_MS);
			try { (pending.timer as any).unref?.(); } catch { /* ignore */ }
			pendingReplies.set(msg_id, pending);
			return {
				content: [{ type: "text" as const, text: `coms_send -> ${target.name}\nmsg_id ${msg_id}\nhops ${hops}` }],
				details: { msg_id, target: target.name, target_session: target.session_id, hops },
			};
		},
	});

	pi.registerTool({
		name: "coms_get",
		label: "Coms Get",
		description: "Poll a pending coms_send reply without blocking.",
		parameters: Type.Object({
			msg_id: Type.String({ description: "msg_id returned by coms_send." }),
		}),
		async execute(_callId: string, params: any) {
			const pending = pendingReplies.get(params.msg_id);
			if (!pending) {
				return {
					content: [{ type: "text" as const, text: `coms_get: unknown msg_id ${params.msg_id}` }],
					details: { status: "error", error: "unknown msg_id" },
				};
			}
			if (!pending.result) {
				return {
					content: [{ type: "text" as const, text: "coms_get: pending" }],
					details: { status: "pending" },
				};
			}
			const text = pending.result.error
				? `coms_get: error - ${pending.result.error}`
				: typeof pending.result.response === "string"
					? pending.result.response
					: JSON.stringify(pending.result.response, null, 2);
			return {
				content: [{ type: "text" as const, text }],
				details: { status: "complete", response: pending.result.response, error: pending.result.error ?? null },
			};
		},
	});

	pi.registerTool({
		name: "coms_await",
		label: "Coms Await",
		description: "Wait until a pending coms_send reply lands or timeout fires.",
		parameters: Type.Object({
			msg_id: Type.String({ description: "msg_id returned by coms_send." }),
			timeout_ms: Type.Optional(Type.Number({ description: "Override timeout in ms." })),
		}),
		async execute(_callId: string, params: any) {
			const pending = pendingReplies.get(params.msg_id);
			if (!pending) {
				return {
					content: [{ type: "text" as const, text: `coms_await: unknown msg_id ${params.msg_id}` }],
					details: { error: "unknown msg_id" },
				};
			}
			const timeoutMs = typeof params.timeout_ms === "number" && params.timeout_ms > 0 ? params.timeout_ms : TIMEOUT_MS;
			const timeout = new Promise<{ error: string }>((resolve) => {
				const timer = setTimeout(() => resolve({ error: "timeout" }), timeoutMs);
				try { (timer as any).unref?.(); } catch { /* ignore */ }
			});
			const result = await Promise.race([pending.promise, timeout]);
			if (result.error) {
				return {
					content: [{ type: "text" as const, text: `coms_await: error - ${result.error}` }],
					details: { error: result.error },
				};
			}
			const response = result.response;
			return {
				content: [{ type: "text" as const, text: typeof response === "string" ? response : JSON.stringify(response, null, 2) }],
				details: { response },
			};
		},
	});

	pi.on("agent_end", async (_event: unknown, ctx: any) => {
		const inbound = [...inboundQueue.values()].reverse().find((item) => !item.fulfilled);
		if (!inbound || !identity) return;
		const lastAssistantText = getAssistantText(ctx);
		let payload: unknown = lastAssistantText;
		let error: string | null = null;
		if (inbound.response_schema && typeof inbound.response_schema === "object") {
			try {
				payload = JSON.parse(lastAssistantText);
			} catch {
				error = "response not valid JSON";
				payload = null;
			}
		}
		try {
			await sendEnvelope(inbound.sender_endpoint, {
				type: "response",
				msg_id: inbound.msg_id,
				sender_session: identity.session_id,
				sender_endpoint: identity.endpoint,
				hops: 0,
				timestamp: nowIso(),
				response: payload,
				error,
			});
		} catch {
			// sender may have exited; keep shutdown cleanup best effort
		}
		inbound.fulfilled = true;
		inboundQueue.delete(inbound.msg_id);
		if (currentInbound?.msg_id === inbound.msg_id) currentInbound = null;
	});

	pi.registerCommand("coms", {
		description: "Show minimal coms status.",
		handler: async (_args: string, ctx: any) => {
			const name = identity ? `${identity.name}@${identity.project}` : "not initialised";
			notify(ctx, `coms-lite: ${name}, pending=${pendingReplies.size}, inbound=${inboundQueue.size}`, "info");
		},
	});

	let shuttingDown = false;
	async function cleanShutdown(): Promise<void> {
		if (shuttingDown) return;
		shuttingDown = true;
		if (keepaliveTimer) {
			clearInterval(keepaliveTimer);
			keepaliveTimer = null;
		}
		if (server) {
			try { server.close(); } catch { /* ignore */ }
			server = null;
		}
		if (identity) {
			if (process.platform !== "win32") {
				try { fs.unlinkSync(identity.endpoint); } catch { /* ignore */ }
			}
			removeRegistryEntry(identity.project, identity.name);
			try { pi.appendEntry("coms-log", { event: "shutdown", session_id: identity.session_id, lite: true }); } catch { /* ignore */ }
		}
	}

	pi.on("session_shutdown", async () => { await cleanShutdown(); });
	process.on("SIGINT", () => { void cleanShutdown(); });
	process.on("SIGTERM", () => { void cleanShutdown(); });
}
