import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dir, "..");
const sourcePath = path.join(repoRoot, "extensions", "coms-omp.ts");
const liteSourcePath = path.join(repoRoot, "extensions", "coms-omp-lite.ts");

function readSource(): string {
	return readFileSync(sourcePath, "utf-8");
}

function readLiteSource(): string {
	return readFileSync(liteSourcePath, "utf-8");
}

function makeTypeShim() {
	const scalar = () => ({ kind: "scalar" });
	const passthrough = (value?: unknown) => ({ kind: "schema", value });
	return {
		Type: {
			Any: scalar,
			Boolean: scalar,
			Number: scalar,
			String: scalar,
			Object: (shape: unknown) => ({ kind: "object", shape }),
			Optional: passthrough,
		},
	};
}

describe("coms-omp extension boundaries", () => {
	test("uses OMP packages and OMP coms storage by default", () => {
		const source = readSource();

		expect(source).toContain("@oh-my-pi/pi-coding-agent");
		expect(source).toContain("@oh-my-pi/pi-tui");
		expect(source).toContain('".omp", "coms"');
		expect(source).toContain("OMP_COMS_DIR");
		expect(source).toContain("./themeMap-omp.ts");

		expect(source).not.toContain("@mariozechner/");
		expect(source).not.toContain("@earendil-works/");
		expect(source).not.toContain('from "typebox"');
		expect(source).not.toContain("@sinclair/typebox");
		expect(source).not.toContain('".pi", "coms"');
		expect(source).not.toContain("PI_COMS_DIR");
	});

	test("registers core flags and tools using the injected OMP typebox shim", async () => {
		const extension = (await import("../extensions/coms-omp-lite.ts")).default;
		const flags: string[] = [];
		const tools: string[] = [];
		const commands: string[] = [];
		const events: string[] = [];

		const fakePi = {
			typebox: makeTypeShim(),
			appendEntry() {},
			getFlag() {
				return undefined;
			},
			on(event: string) {
				events.push(event);
			},
			registerCommand(name: string) {
				commands.push(name);
			},
			registerFlag(name: string) {
				flags.push(name);
			},
			registerTool(tool: { name: string }) {
				tools.push(tool.name);
			},
		};

		extension(fakePi as never);

		expect(flags).toEqual(["cname", "purpose", "project", "color", "explicit"]);
		expect(tools).toEqual(["coms_list", "coms_send", "coms_get", "coms_await"]);
		expect(commands).toEqual(["coms"]);
		expect(events).toContain("session_start");
		expect(events).toContain("agent_end");
		expect(events).toContain("session_shutdown");
	});

	test("lite entry avoids runtime OMP package imports", () => {
		const source = readLiteSource();

		expect(source).not.toMatch(/from\s+["']@oh-my-pi\//);
		expect(source).not.toMatch(/from\s+["']@mariozechner\//);
		expect(source).not.toMatch(/from\s+["']@earendil-works\//);
		expect(source).toContain("coms_list");
		expect(source).toContain("coms_send");
		expect(source).toContain("coms_get");
		expect(source).toContain("coms_await");
	});
});
