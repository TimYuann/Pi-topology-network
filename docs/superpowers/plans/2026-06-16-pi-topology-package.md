# Pi Topology Package Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local, installable Pi package skeleton for OMP拓扑网络 that can initialize mission cards, enforce role/path guards, validate packet-first communication, expose minimal Pi extension tools, and document dogfood/package readiness.

**Architecture:** The package lives under `packages/pi-topology/`. Pi extension registration stays thin and delegates to testable runtime, transport, guard, packet, and state modules. Runtime state is JSON/JSONL so future Web UI and dogfood sessions can replay mission, packet, incident, and health evidence.

**Tech Stack:** TypeScript ESM, Node 22 `--experimental-strip-types`, Node test runner, Pi extension API surface by type-only imports, JSON/JSONL state files.

---

### Task 1: Package Skeleton and Runtime Contracts

**Files:**
- Create: `packages/pi-topology/package.json`
- Create: `packages/pi-topology/index.ts`
- Create: `packages/pi-topology/src/runtime/mission.ts`
- Create: `packages/pi-topology/src/runtime/status-board.ts`
- Create: `packages/pi-topology/src/runtime/watchdog.ts`
- Test: `packages/pi-topology/test/unit/mission.test.ts`

- [ ] **Step 1: Write failing tests**

Test mission draft creation, mission validation, and initial status board owner gate.

- [ ] **Step 2: Run red test**

Run: `npm test --workspace packages/pi-topology -- mission`
Expected: fail because package files do not exist yet.

- [ ] **Step 3: Implement minimal runtime contracts**

Create mission/status/watchdog modules with no Pi runtime dependency.

- [ ] **Step 4: Run green test**

Run: `npm test --workspace packages/pi-topology -- mission`
Expected: pass.

### Task 2: Packet and Guard Rules

**Files:**
- Create: `packages/pi-topology/src/runtime/packet.ts`
- Create: `packages/pi-topology/src/runtime/guard.ts`
- Create: `packages/pi-topology/src/utils/safe-paths.ts`
- Test: `packages/pi-topology/test/unit/packet.test.ts`
- Test: `packages/pi-topology/test/unit/guard.test.ts`

- [ ] **Step 1: Write failing tests**

Test ACK-only direct replies, structured business packet validation, hop policy, repair write allowlist, and runner/oracle read-only defaults.

- [ ] **Step 2: Run red tests**

Run: `npm test --workspace packages/pi-topology -- packet guard`
Expected: fail because modules do not exist.

- [ ] **Step 3: Implement packet and guard modules**

Use explicit result objects so blocked actions can become incident events.

- [ ] **Step 4: Run green tests**

Run: `npm test --workspace packages/pi-topology -- packet guard`
Expected: pass.

### Task 3: State, Transport, Spawn, and Extension Surface

**Files:**
- Create: `packages/pi-topology/src/state/paths.ts`
- Create: `packages/pi-topology/src/state/event-log.ts`
- Create: `packages/pi-topology/src/state/incident-log.ts`
- Create: `packages/pi-topology/src/transport/registry.ts`
- Create: `packages/pi-topology/src/transport/local-coms.ts`
- Create: `packages/pi-topology/src/transport/response-capture.ts`
- Create: `packages/pi-topology/src/transport/net-coms.ts`
- Create: `packages/pi-topology/src/runtime/spawn.ts`
- Create: `packages/pi-topology/src/extension/register.ts`
- Create: `packages/pi-topology/src/extension/tools.ts`
- Create: `packages/pi-topology/src/extension/commands.ts`
- Create: `packages/pi-topology/src/extension/ui.ts`
- Test: `packages/pi-topology/test/unit/state-transport.test.ts`
- Test: `packages/pi-topology/test/unit/spawn.test.ts`
- Test: `packages/pi-topology/test/unit/extension.test.ts`

- [ ] **Step 1: Write failing tests**

Test registry paths, atomic peer registration, packet outbox append, bundled role prompt spawn args, and registered tool names.

- [ ] **Step 2: Run red tests**

Run: `npm test --workspace packages/pi-topology -- state-transport spawn extension`
Expected: fail because modules do not exist.

- [ ] **Step 3: Implement minimal modules**

Keep network transport as an explicit compatibility target/stub until smoke tested.

- [ ] **Step 4: Run green tests**

Run: `npm test --workspace packages/pi-topology -- state-transport spawn extension`
Expected: pass.

### Task 4: Bundled Agents, Skill, and Docs

**Files:**
- Create: `packages/pi-topology/agents/topology-supervisor.md`
- Create: `packages/pi-topology/agents/hq.md`
- Create: `packages/pi-topology/agents/repair.md`
- Create: `packages/pi-topology/agents/runner.md`
- Create: `packages/pi-topology/agents/oracle.md`
- Create: `packages/pi-topology/agents/shared-protocol.md`
- Create: `packages/pi-topology/skills/topology-runtime/SKILL.md`
- Create: `packages/pi-topology/docs/install.md`
- Create: `packages/pi-topology/docs/dogfood.md`
- Create: `packages/pi-topology/docs/package-hub-readiness.md`
- Modify: `README.md`

- [ ] **Step 1: Add agent prompts and skill**

Use project iron rules and mark Pi runtime features that are not smoke tested as compatibility targets.

- [ ] **Step 2: Add package docs**

Document install, local dogfood, status/doctor/cleanup/smoke surfaces, and readiness gaps.

- [ ] **Step 3: Update root README**

Link the package as the current Pi-first productization target.

### Task 5: Verification and Closeout

**Files:**
- Modify: package files only if verification exposes issues.

- [ ] **Step 1: Run unit suite**

Run: `npm test --workspace packages/pi-topology`
Expected: pass.

- [ ] **Step 2: Run type/import smoke**

Run: `npm run typecheck --workspace packages/pi-topology`
Expected: pass.

- [ ] **Step 3: Run package dry run**

Run: `npm pack --dry-run --workspace packages/pi-topology`
Expected: package contents include extension, agents, skills, docs, tests excluded.

- [ ] **Step 4: Report limits**

State that `pi install .` and real multi-session dogfood were not executed unless they were actually run.
