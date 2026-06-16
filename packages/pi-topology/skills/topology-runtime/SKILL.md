---
name: topology-runtime
description: "Operate the OMP拓扑网络 Pi topology runtime tools and status workflow."
origin: pi-topology package
---

# Topology Runtime

Used by OMP拓扑网络 roles in the new Pi package runtime.

## Positioning

- Pi is the current productization runtime.
- OMP is legacy compatibility/reference context, not the primary active runtime for this package.

## Available Tools

Use slash commands for owner-facing startup:

- `/topology`
- `/topology <task goal or task card>`
- `/topology init <task card>` (compatibility form)
- `/topology status`
- `/topology doctor`
- `/topology packets`
- `/topology spawn hq`

Use package tools in this order inside role/tool workflows:

- `topology_init_mission`
- `topology_status`
- `topology_doctor`
- `topology_smoke`
- `topology_spawn_role`
- `topology_send`
- `topology_get`
- `topology_list`
- `topology_cleanup`

### Slash Command Semantics

- `/topology` is the smart intake entry. It resumes an existing mission, or drafts a mission from the latest assistant task card when one is visible in session context. If no task card is visible, it shows intake/preflight guidance.
- `/topology <task goal or task card>` creates the mission card, status board, runtime boot events, session ledger, and launch scripts without requiring the `init` keyword.
- `/topology init <task card>` is a compatibility form for explicit init. Treat both creation paths as owner intent to start a topology goal-mode run.
- `/topology spawn hq` is not the same as init. It is the owner-facing checkpoint before expanding into a separate HQ role session.

### 1) `topology_init_mission`

Create and validate mission context before spawning:

- project/workdir/objective
- `allowed_paths` and `forbidden_actions`
- owner gate and stop conditions
- initial status board + incident log paths

Use for first intake, and re-run after scope change.

### 2) `topology_status`

Inspect current topology runtime state:

- mission card
- active peers (`alive`, `state`, `context_used_pct`)
- session ledger path and record count
- pending packets / pending checkpoints
- incidents and evidence index

Use to answer owner checkpoints and before long commands.

### 3) `topology_doctor`

Run operator health checks:

- peer registry + heartbeat integrity
- packet trace completeness
- late/missing result pattern
- owner-gate enforcement

Treat doctor output as business evidence in reports.

### 4) `topology_smoke`

Minimal acceptance smoke for tool/command registration and command path sanity.

Important: real MiniMax M3 + Ghostty smoke was verified on 2026-06-16 for local JSONL transport and role/tool behavior. HTTP/SSE transport remains a compatibility target.

### 5) `topology_cleanup`

Release local/topology session artifacts and temp runtime state in non-production workspaces.

Use only with explicit mission-level scope; do not delete runtime DB/cache during active sessions unless owner permits.

## Session Ledger Contract

`.pi/topology/sessions.jsonl` is the project-level topology session ledger.

- `script_written` means a role launch script exists; it is not proof of a live session.
- `launch_printed` means a launch command was prepared or printed.
- `launch_requested` means the terminal app was asked to open a role script.
- `session_id: null` means the role has not self-confirmed alive yet.
- Treat only a future `alive_confirmed` record, registry heartbeat, packet evidence, or equivalent runtime evidence as proof that a role session is live.

## Send + Evidence Contract

- All business outputs from these tools should flow through structured packets where possible.
- Reports must separate:
  - transport evidence
  - business evidence
  - inference

## Capability Status

- Package tool registration is present in current package code and unit assertions.
- `pi install .` and real multi-session MiniMax M3 + Ghostty smoke are verified in local artifacts.
- HTTP/SSE transport and Package Hub publication remain outside the verified local scope.
