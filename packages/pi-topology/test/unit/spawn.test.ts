import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createMissionDraft } from "../../src/runtime/mission.ts";
import { buildRoleLaunchPlan, TOPOLOGY_HQ_INITIAL_PROMPT, TOPOLOGY_SUPERVISOR_INITIAL_PROMPT, writeMissionLaunchScriptsSync, writeRoleLaunchScript } from "../../src/runtime/spawn.ts";

test("builds bundled prompt launch args for real Pi role sessions", () => {
  const mission = createMissionDraft({
    project: "dogfood",
    workdir: "/work/project",
    objective: "Spawn roles",
    allowed_paths: ["/work/project/packages/pi-topology"],
  });

  const plan = buildRoleLaunchPlan(mission, "runner", {
    packageRoot: "/pkg/pi-topology",
    missionPath: "/work/project/.pi/topology/mission-card.json",
    registryRoot: "/tmp/pi-topology-dogfood",
  });

  assert.equal(plan.command, "pi");
  assert.equal(plan.env.PI_TOPOLOGY_MISSION_ID, mission.mission_id);
  assert.equal(plan.env.PI_TOPOLOGY_WORKDIR, "/work/project");
  assert.equal(plan.env.PI_COMS_DIR, "/tmp/pi-topology-dogfood");
  assert.equal(plan.env.PI_TOPOLOGY_PROVIDER, "minimax-cn");
  assert.equal(plan.env.PI_TOPOLOGY_MODEL, "MiniMax-M3");
  assert.equal(plan.args.includes("--tools"), true);
  assert.equal(plan.args.includes("topology_status,topology_doctor,topology_smoke,topology_send,topology_write_artifact,topology_read_artifact,topology_get,topology_list,read,grep,find,ls,bash"), true);
  assert.equal(plan.args.some((arg) => arg.includes("topology_await")), false);
  assert.equal(plan.args.includes("--purpose"), false);
  assert.equal(plan.args.includes("--append-system-prompt"), true);
  assert.equal(plan.args.includes("/pkg/pi-topology/agents/shared-protocol.md"), true);
  assert.equal(plan.args.includes("/pkg/pi-topology/agents/runner.md"), true);
});

test("all role launch plans default to MiniMax M3 for real Pi smokes", () => {
  const mission = createMissionDraft({
    project: "dogfood",
    workdir: "/work/project",
    objective: "Spawn oracle",
    allowed_paths: ["/work/project/packages/pi-topology"],
  });

  const plan = buildRoleLaunchPlan(mission, "oracle", {
    packageRoot: "/pkg/pi-topology",
    missionPath: "/work/project/.pi/topology/mission-card.json",
    registryRoot: "/tmp/pi-topology-dogfood",
  });

  assert.deepEqual(
    plan.args.slice(plan.args.indexOf("--provider"), plan.args.indexOf("--provider") + 4),
    ["--provider", "minimax-cn", "--model", "MiniMax-M3"],
  );
});

test("hq launch plan is dispatch-first and cannot inherit executor tools from a custom prompt", () => {
  const mission = createMissionDraft({
    project: "dogfood",
    workdir: "/work/project",
    objective: "Coordinate role sessions",
    allowed_paths: ["/work/project"],
  });

  const plan = buildRoleLaunchPlan(mission, "hq", {
    packageRoot: "/pkg/pi-topology",
    missionPath: "/work/project/.pi/topology/mission-card.json",
    registryRoot: "/tmp/pi-topology-dogfood",
    initialPrompt: "Run git status, inspect the repo, run tests, and write incident-log.jsonl.",
  });

  const tools = plan.args[plan.args.indexOf("--tools") + 1].split(",");
  assert.equal(tools.includes("topology_spawn_role"), true);
  assert.equal(tools.includes("topology_send"), true);
  assert.equal(tools.includes("topology_write_artifact"), true);
  assert.equal(tools.includes("topology_read_artifact"), true);
  assert.equal(tools.includes("topology_await"), false);
  assert.equal(tools.includes("bash"), false);
  assert.equal(tools.includes("read"), false);
  assert.equal(tools.includes("write"), false);
  assert.equal(plan.args.includes(TOPOLOGY_HQ_INITIAL_PROMPT), false);
  const prompt = plan.args.at(-1) ?? "";
  assert.match(prompt, /do not duplicate live runner\/oracle\/librarian sessions/);
  assert.match(prompt, /Mission note only/);
  assert.match(prompt, /not authority to bypass dispatch/);
  assert.match(prompt, /Run git status/);
});

test("mission launch scripts use current terminal for supervisor and Ghostty for workers", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-topology-mission-launch-"));
  const mission = createMissionDraft({
    project: "dogfood",
    workdir: dir,
    objective: "Spawn supervisor first",
    allowed_paths: [dir],
  });

  const entries = writeMissionLaunchScriptsSync(mission, {
    packageRoot: "/pkg/pi-topology",
    missionPath: join(dir, ".pi/topology/mission-card.json"),
    registryRoot: "/tmp/pi-topology-dogfood",
  });

  const supervisor = entries.find((entry) => entry.role === "topology-supervisor");
  const hq = entries.find((entry) => entry.role === "hq");
  assert.match(supervisor?.launchCommand ?? "", /^cd /);
  assert.match(supervisor?.launchCommand ?? "", /topology-supervisor\.sh/);
  assert.doesNotMatch(supervisor?.launchCommand ?? "", /open -n -a/);
  assert.match(hq?.launchCommand ?? "", /open -n -a 'Ghostty'/);
  assert.match(hq?.launchCommand ?? "", /hq\.sh/);

  const supervisorScript = await readFile(supervisor?.scriptPath ?? "", "utf8");
  assert.match(supervisorScript, /mode="launch"/);
  assert.match(supervisorScript, /terminal_app="Ghostty"/);
  assert.match(supervisorScript, /Do not call topology_send/);
  assert.equal(TOPOLOGY_SUPERVISOR_INITIAL_PROMPT.includes('mode="launch"'), true);
});

test("writes an executable role launch script for Ghostty spawn", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-topology-spawn-"));
  const mission = createMissionDraft({
    project: "dogfood",
    workdir: dir,
    objective: "Spawn HQ",
    allowed_paths: [dir],
  });
  const plan = buildRoleLaunchPlan(mission, "hq", {
    packageRoot: "/pkg/pi-topology",
    missionPath: join(dir, ".pi/topology/mission-card.json"),
    registryRoot: "/tmp/pi-topology-dogfood",
  });

  const scriptPath = await writeRoleLaunchScript(dir, plan);
  const script = await readFile(scriptPath, "utf8");
  assert.match(script, /PI_TOPOLOGY_MISSION_ID=/);
  assert.match(script, /PI_TOPOLOGY_LAUNCH_SCRIPT=/);
  assert.match(script, /cd "\$\{PI_TOPOLOGY_WORKDIR\}"/);
  assert.match(script, /'--cname' 'hq'/);
  assert.match(script, /exec pi/);
});

test("launch scripts can feed an initial prompt and tee role output to a log", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-topology-spawn-log-"));
  const mission = createMissionDraft({
    project: "dogfood",
    workdir: dir,
    objective: "Spawn HQ with evidence",
    allowed_paths: [dir],
  });
  const plan = buildRoleLaunchPlan(mission, "hq", {
    packageRoot: "/pkg/pi-topology",
    missionPath: join(dir, ".pi/topology/mission-card.json"),
    registryRoot: "/tmp/pi-topology-dogfood",
    initialPrompt: "Call topology_status, then topology_doctor, then send a packet.",
  });

  const scriptPath = await writeRoleLaunchScript(dir, plan, {
    logPath: join(dir, ".pi/topology/logs/hq-spawn.log"),
  });
  const script = await readFile(scriptPath, "utf8");

  assert.match(script, /mkdir -p/);
  assert.match(script, /PI_TOPOLOGY_ROLE_LOG=/);
  assert.match(script, /\[topology\] launch/);
  assert.doesNotMatch(script, /\| tee -a/);
  assert.match(script, /hq-spawn\.log/);
  assert.doesNotMatch(script, /'-p'/);
  assert.match(script, /Mission note only/);
  assert.match(script, /send a packet/);
});
