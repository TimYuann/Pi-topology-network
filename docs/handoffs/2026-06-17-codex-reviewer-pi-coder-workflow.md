# Codex Reviewer / Pi Coder Workflow

Date: 2026-06-17
Project: OMP topology network / `packages/pi-topology`
Purpose: run the next topology redesign pass with Codex as the review/design side and a real Pi MiniMax-M3 session as the implementation side.

## 0. Operating Model

This round should not be one session designing, implementing, testing, and judging itself.

Use two explicit roles:

1. Codex Reviewer
   - Owns product framing, PRD/spec quality, official Pi API alignment, code review, evidence review, and final acceptance.
   - Does not start by editing runtime code.
   - May write docs, review diffs, run local tests, and ask for implementation corrections.
2. Pi Coder
   - Runs in a real Pi session on MiniMax-M3.
   - Implements only from approved PRD/spec/plan.
   - Keeps changes small, commits locally, and reports test/evidence paths.

The working style is:

```text
Codex Reviewer defines and checks the target.
Pi Coder executes narrow implementation slices.
Codex Reviewer reviews evidence before the next slice.
```

## 1. Five-Step Plan

### Step 1: Write the PRD

Create a product document for the next `pi-topology` shape.

The PRD must describe:

- Mission-oriented workflow: Supervisor selects or creates a Mission, then launches/resumes role sessions for that Mission.
- File-driven runtime: Mission state lives in project files, not only in chat messages.
- Session persistence: a Mission should remember its role session IDs and resume them when practical.
- Lifecycle: create Mission, build team, execute, review, deliver, archive, and dissolve or park sessions.
- User experience: `/topology` starts with a clear mission choice and a concise dashboard.
- Non-goals: no speculative autonomous society, no hidden permission transfer, no unbounded background spawning.

Expected output:

```text
docs/13-pi-topology-mission-runtime-prd.md
```

### Step 2: Write the Spec

Translate the PRD into implementation-level contracts.

The spec must define:

- Directory layout for `.pi/topology/`, including mission registry, per-mission folders, status board, runtime events ledger, packet ledger, artifacts, and launch scripts.
- State machine for Mission, Session, Task, Packet, Artifact, and Incident.
- How Supervisor chooses a Mission and how it distinguishes new, resumed, archived, and blocked Missions.
- How HQ, runner, scott/scout, oracle, librarian, and repair are launched or resumed.
- How inbox cleanup works without deleting evidence.
- How stale packets are marked, ignored, or preserved.
- How direct generated-script launch remains supported while Ghostty GUI launch is unstable on this Mac.

Expected output:

```text
docs/14-pi-topology-mission-runtime-spec.md
```

### Step 3: Align With Official Pi APIs

Before implementation, verify the spec against official Pi documentation and installed local Pi behavior.

Required checks:

- Sessions: session creation, resume semantics, `pi.sendMessage`, `deliverAs`, and any native lifecycle hooks.
- Extensions: event hooks, tool registration, slash command behavior, footer/widget support, and package boundaries.
- Skills: skill discovery, role skill visibility, slash command presentation, and skill frontmatter expectations.
- Package model: `package.json` `pi` key, extension paths, skill paths, conventional folders, install behavior.

Rules:

- Prefer official Pi primitives when they exist.
- Label anything not supported by Pi as `compatibility_target`, `local_protocol`, or `pending`.
- Do not present HTTP/SSE mesh, multi-host runtime, or Ghostty unattended GUI launch as proven unless evidence exists.

Expected output:

```text
records/2026-06-17-pi-topology-mission-runtime-api-audit.md
```

### Step 4: Compare Current Infrastructure

Build a gap matrix from PRD/spec/API audit to current code.

The matrix should classify each item as:

- `reuse`: current code is good enough.
- `adapt`: current code can be extended safely.
- `replace`: current code fights the target shape.
- `defer`: valuable, but not needed for the next stable dogfood loop.

Current reusable pieces likely include:

- `topology_status`, `topology_doctor`, and dashboard/footer rendering.
- `sessions.jsonl`, `runtime-events.jsonl`, `status-board.json`, and incident logging.
- `topology_write_artifact` / `topology_read_artifact`.
- Current-mission filtering and packet read de-noising.
- Print-mode launch scripts and direct generated-script lane.

Current suspect areas:

- Single global `.pi/topology/mission-card.json`.
- Stale peer/session semantics across restarts.
- Inbox cleanup and historical packet visibility.
- Supervisor mission choice UX.
- Role session resume versus new session creation.

Expected output:

```text
records/2026-06-17-pi-topology-mission-runtime-gap-analysis.md
```

### Step 5: Implement in Reviewable Slices

Only after Steps 1-4 are reviewed should Pi Coder begin code changes.

Recommended slice order:

1. Mission registry and per-mission directory layout.
2. Supervisor mission picker and mission resume/create flow.
3. Session registry semantics for role session IDs and stale/alive evidence.
4. Inbox cleanup and stale packet marking.
5. Dashboard/status output for multi-mission state.
6. Migration from the current single-mission layout.
7. Final dogfood mission with direct generated-script launches.

Each slice must include:

- A short implementation note.
- Focused tests.
- `npm run smoke` from `packages/pi-topology`.
- Local commit.
- Reviewer approval before the next slice.

## 6. Codex Reviewer Startup Prompt

Use this prompt when opening the new Codex Reviewer session:

```text
You are the Codex Reviewer for OMP topology network.

Repository:
/Users/yuantian/Documents/Coding/omp-topology-network

Read first:
- AGENTS.md
- docs/handoffs/2026-06-17-codex-reviewer-pi-coder-workflow.md
- docs/12-pi-topology-native-alignment-blueprint.md
- records/2026-06-17-pi-topology-local-stability-e2e.md
- /Users/yuantian/Downloads/ChatGPT-advice-topology.html, if readable from this environment

Your job:
1. Produce or review the PRD at docs/13-pi-topology-mission-runtime-prd.md.
2. Produce or review the spec at docs/14-pi-topology-mission-runtime-spec.md.
3. Verify alignment with official Pi sessions/extensions/skills/package behavior.
4. Produce a gap matrix against the current package.
5. Review Pi Coder implementation slices before the next slice begins.

Do not start by editing runtime code.
Do not push.
Do not use unattended Ghostty GUI launch as acceptance evidence.
Use local commits for coherent documentation/review changes.
Pause for owner decisions on mission storage shape, session resume semantics, migration policy, or permission boundary changes.
```

## 7. Pi Coder Startup Prompt

Use this prompt when opening the new Pi MiniMax-M3 Coder session:

```text
You are the Pi Coder for OMP topology network.

Repository:
/Users/yuantian/Documents/Coding/omp-topology-network

Runtime:
- Use MiniMax-M3.
- Work as an implementation session, not as final reviewer.
- Follow Codex Reviewer's approved PRD/spec/plan.

Read first:
- AGENTS.md
- docs/handoffs/2026-06-17-codex-reviewer-pi-coder-workflow.md
- docs/13-pi-topology-mission-runtime-prd.md, when available
- docs/14-pi-topology-mission-runtime-spec.md, when available
- records/2026-06-17-pi-topology-mission-runtime-gap-analysis.md, when available

Rules:
- Do not implement before the Reviewer has approved the slice.
- Do not push.
- Do not run destructive git commands.
- Do not broaden scope while coding.
- Use small local commits.
- Run npm run smoke in packages/pi-topology after code changes.
- Report changed files, tests, evidence paths, and commit hash.
- If a change requires official Pi behavior not verified in the spec, stop and ask the Reviewer/owner.
```

Suggested Pi launch command if the active profile is not already MiniMax-M3:

```bash
cd /Users/yuantian/Documents/Coding/omp-topology-network
pi --provider minimax-cn --model MiniMax-M3 --thinking low
```

If the local Pi profile is already MiniMax-M3, plain `pi` is acceptable.

## 8. Decision Gates

Pause and ask the owner before:

- Changing the mission directory schema in a way that needs migration.
- Treating historical session context as authoritative live evidence.
- Deleting packets, artifacts, ledgers, or mission folders.
- Introducing a new transport layer beyond local JSONL/files.
- Adding HTTP/SSE, multi-host, or background daemon behavior.
- Re-enabling unattended Ghostty GUI E2E as a required gate.
- Adding package install/publish flows.
- Changing the role permission model.

## 9. Acceptance For This Round

This workflow round is successful when:

1. PRD and spec exist and are internally consistent.
2. Official Pi API audit separates supported primitives from local protocol.
3. Gap analysis identifies reuse/adapt/replace/defer items.
4. Pi Coder implements only reviewed slices.
5. `npm run smoke` passes from `packages/pi-topology` after implementation.
6. A direct generated-script dogfood path can run without relying on unattended Ghostty GUI.
7. Reviewer records remaining risks clearly before declaring the implementation ready.
