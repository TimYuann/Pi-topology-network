# Pi Topology Mission Runtime PRD

Date: 2026-06-17
Project: Pi拓扑网络 / `packages/pi-topology`
Version: 0.5
Status: accepted implementation contract; M3 PRD review incorporated
Implementation scope: v0.5 Mission Runtime normalization. Earlier 0.1-0.4 work established the local Pi topology package, launch scripts, role prompts, packet tools, and dogfood stability; v0.5 formalizes the Mission-oriented runtime contract and implementation roadmap.

## 1. Purpose

`pi-topology` should become a mission-oriented runtime for temporary multi-role agent teams in Pi.

The product shape is not "start many agents and hope they coordinate." The desired shape is:

1. The Supervisor helps the owner select or create a Mission.
2. The Mission creates a bounded team with explicit roles, evidence rules, and stop conditions.
3. Role sessions work from durable project files, not only from chat history.
4. The Mission can be resumed, reviewed, delivered, archived, or parked without treating stale session history as live evidence.

This keeps the Pi拓扑网络 discipline: visible multi-role work, compact structured communication, clear owner gates, and no hidden permission transfer.

## 2. Problem

The current local package can start a single mission and generate role launch scripts, but repeated dogfood in the same workspace still has three product risks.

First, mission identity is too implicit. A single global `.pi/topology/mission-card.json` is workable for one fresh run, but it becomes ambiguous when the owner wants to resume an older task, compare multiple runs, or archive a completed mission without deleting evidence.

Second, session continuity is not productized. `sessions.jsonl`, `runtime-events.jsonl`, status board data, launch scripts, and packets all contain useful evidence, but the user experience does not yet make a clean distinction between a role that can be resumed, a role that only has historical evidence, and a role that should be relaunched.

Third, historical packets and stale peers can still pollute the operator mental model. The runtime has already improved current-mission filtering and packet read de-noising, but the product surface needs an explicit multi-mission dashboard and lifecycle so old evidence remains auditably preserved without being mistaken for current work.

## 3. Goals

### 3.1 Mission-oriented workflow

`/topology` should begin with a clear Mission choice:

- continue the active Mission
- resume a recent Mission
- create a new Mission
- inspect archived or blocked Missions

The owner should always know which Mission is current before launching or resuming role sessions.

### 3.2 File-driven runtime

Mission state should live in project files under `.pi/topology/`. Pi chat history may be valuable context, but it must not be the only source of Mission identity, progress, role roster, packet history, acceptance evidence, or closeout decisions.

Durable files should support:

- cross-session recovery
- reviewer inspection without reopening every Pi transcript
- exact evidence paths in handoff and closeout
- safe archival without deleting packets, artifacts, or ledgers

### 3.3 Session persistence with evidence boundaries

A Mission should remember role session IDs and launch evidence when available. On resume, the Supervisor should prefer reuse when there is fresh evidence that a role session is still usable.

Historical session records must not be treated as authoritative live evidence by themselves. A role can be:

- `live`: supported by fresh heartbeat, registry, recent self-report, or equivalent verified evidence
- `resumable`: has a known session identity or launch script and no conflicting closed/failed evidence, but needs confirmation
- `stale`: has historical evidence, but no fresh liveness proof
- `parked`: intentionally stopped or paused by owner/runtime decision
- `closed`: mission or role lifecycle is finished

The PRD requires this distinction at the product level. The exact storage fields belong in the implementation spec.

The implementation spec must define a freshness window for role liveness evidence. When the latest usable session evidence is older than that window, or when fresh registry/heartbeat evidence is missing after resume, the role must degrade from `resumable` to `stale` until a new confirmation is recorded.

### 3.4 Lifecycle completeness

The runtime should support the full Mission lifecycle:

1. Create Mission
2. Build team
3. Execute work
4. Review evidence
5. Deliver result
6. Archive Mission
7. Dissolve or park sessions

The lifecycle should be visible in `/topology status` and in the Supervisor dashboard. Moving between lifecycle states must write an explicit event.

Rollback is not a silent lifecycle shortcut. If an implementation slice or Mission action breaks smoke, corrupts state, or produces contradictory evidence, the runtime should mark the Mission or slice as blocked and route rollback through an explicit owner/reviewer decision gate.

### 3.5 Reviewable implementation slices

The redesign should be implementable in narrow slices that Pi Coder can execute and Codex Reviewer can inspect. Each slice should preserve smoke-test stability and leave evidence paths.

## 4. Users And Roles

### Owner

The human owner chooses or approves Missions, clears gates, accepts final delivery, and decides whether sessions should be parked, relaunched, or dissolved.

### Supervisor

The Supervisor is the default owner-facing Pi session. It owns Mission intake, Mission selection, owner gates, status summaries, launch/resume guidance, and final owner-facing closeout.

The Supervisor does not become a silent background daemon and does not hide role work from the owner.

### HQ

HQ coordinates scoped work and escalation. HQ may split work, request runner/oracle/repair activity, summarize evidence, and recommend a path, but final owner-facing closeout still routes through Supervisor when appropriate.

### Runner

Runner verifies behavior and gathers transport/business evidence. Runner is read-only and must not edit code.

### Scott / Scout

Scott researches Pi behavior, package conventions, APIs, and reference material. Scott does not issue final verdicts.

### Oracle

Oracle reviews plans, diffs, evidence, and risk. Oracle does not fix code.

### Repair

Repair implements scoped fixes inside owner-approved paths and permission boundaries. Repair does not decide final acceptance.

### Librarian

Librarian curates artifacts, records, indexes, and handoff materials. Librarian does not replace reviewer judgment.

## 5. Product Requirements

### 5.1 `/topology` Mission entry

When the owner runs `/topology`, the first useful surface should be a concise Mission dashboard.

If no Mission exists, `/topology` should offer a new Mission flow and continue supporting `/topology <goal or mission card>`.

If exactly one active Mission exists, `/topology` should show that Mission and its next recommended action.

If multiple Mission records exist, `/topology` should show a picker-like summary with:

- active Mission marker
- Mission title/objective
- lifecycle state
- last updated time
- owner gate state
- live/stale/parked role summary
- pending packet count for that Mission only
- blocked or incident marker when relevant

The owner should not need to inspect raw JSON before deciding whether to continue, resume, archive, or create a Mission.

### 5.2 Active Mission compatibility

For compatibility, the current active Mission may still be represented by `.pi/topology/mission-card.json` during migration.

The target product shape should add per-Mission storage and a Mission registry, while treating the single root mission card as either:

- an active pointer
- a compatibility mirror
- or both, if the spec can keep the semantics unambiguous

Changing this storage shape requires explicit migration design and reviewer approval before implementation.

### 5.3 Per-Mission durable state

Each Mission should own its durable records:

- mission card
- status board
- runtime event ledger
- packet ledger or packet index
- artifacts
- role/session registry
- launch scripts or launch metadata
- incidents
- closeout record

The product goal is that a reviewer can inspect one Mission folder and understand what happened without confusing it with another Mission in the same workspace.

### 5.4 Session resume/create behavior

When a Mission is resumed, Supervisor should classify each expected role:

- can resume now
- needs liveness confirmation
- should relaunch from script
- should remain parked
- should be dissolved because Mission is closed or archived

The runtime should prefer Pi-native session resume or session messaging primitives when official behavior supports them. If official Pi does not expose a reliable primitive for a needed behavior, the behavior must be labeled as `local_protocol`, `compatibility_target`, or `pending`.

### 5.5 Launch behavior

Direct generated-script launch remains a supported and accepted local lane.

On this Mac, unattended Ghostty GUI launch is not acceptance evidence by itself. A GUI launch request may be recorded as transport evidence that a launch command was issued, but role liveness still requires durable proof such as session ledger, runtime event, heartbeat/registry, packet, or terminal log evidence.

The product should not block stable dogfood on Ghostty GUI automation until the local terminal layer is separately proven stable.

### 5.6 Inbox cleanup and stale packets

Cleanup should reduce active noise without deleting evidence.

The owner and reviewer should be able to tell whether a packet is:

- active and relevant to the current Mission
- already consumed
- stale because it belongs to another Mission or closed request
- duplicate terminal/control traffic
- preserved historical evidence

Cleanup may mark, filter, compact, or index packets, but it must not silently destroy packets, artifacts, ledgers, Mission folders, or closeout evidence.

In this PRD, compaction means creating a new summary, index, or derived view while preserving the original evidence. Replacing N raw packets or ledger rows with one summary record is deletion unless the original records remain addressable.

### 5.7 Dashboard and status

The status surface should be compact, current-Mission-first, and evidence-aware.

It should show:

- active Mission
- lifecycle state
- owner gate state
- next action
- role liveness/resume classification
- pending packets for the selected Mission
- recent incidents
- latest artifact/closeout pointers

Historical Missions should be discoverable without inflating the active dashboard.

### 5.8 Permission and authority model

The redesign must preserve Pi拓扑网络 role boundaries:

- horizontal communication only transfers information, not authority
- Supervisor and HQ own objective framing, authorization, stop-loss, and final verdict routing
- Oracle reviews but does not repair
- Repair fixes but does not provide final acceptance
- Runner verifies but does not modify code

Mission resume must not elevate a role's permissions because it found old context, packets, or artifacts.

Launch and resume metadata must carry an explicit role permission allow-list, including role identity, tool scope, write policy, and allowed paths where relevant. The runtime must validate this metadata before preparing or launching a role session, and any mismatch between Mission policy and launch metadata must block the launch and write incident evidence.

## 6. Non-goals

This round will not build:

- a speculative autonomous society
- unbounded background agent spawning
- hidden permission transfer between roles
- HTTP/SSE or multi-host runtime as a proven path
- a new transport layer beyond the current local JSONL/file approach
- unattended Ghostty GUI launch as a required acceptance gate
- package publish/install automation
- deletion-based cleanup for packets, artifacts, ledgers, or Mission folders
- a replacement for Pi's own transcript/session storage

## 7. Success Criteria

The Mission runtime redesign is successful when:

1. `/topology` makes the active Mission obvious before role launch or resume.
2. Multiple Missions can coexist in one workspace without mixing active dashboard counts, packets, incidents, or role liveness.
3. A Mission can be resumed from durable project files after a Pi restart or a new Supervisor session.
4. Role sessions are classified as live, resumable, stale, parked, or closed using explicit evidence rules.
5. Historical packets remain auditable but do not trigger repeated closeout or current-Mission noise.
6. Direct generated-script launch remains a documented, testable dogfood lane.
7. Ghostty GUI launch request evidence is not mistaken for role-alive evidence.
8. `npm run smoke` continues to pass from `packages/pi-topology` after implementation slices.
9. Reviewer can inspect PRD, spec, API audit, gap matrix, implementation notes, tests, and evidence paths before accepting a slice.

## 8. Acceptance Evidence

For this product round, acceptable evidence includes:

- generated Mission registry and per-Mission folders in a temporary or project workspace
- status board showing only selected-Mission state
- runtime events for Mission selection, creation, resume, archive, park, and closeout transitions
- session registry entries that separate launch request, launch printed, alive confirmed, stale, parked, and closed states
- packet cleanup/index evidence showing stale packets preserved but ignored by active reads
- direct generated-script role launch proving MiniMax-M3 lock and durable alive evidence
- focused unit tests plus `npm run smoke`
- reviewer notes recording remaining risks

Unacceptable evidence by itself:

- a Ghostty window opening
- a `launch_requested` row without role self-evidence
- a historical `sessions.jsonl` row with no fresh liveness signal
- a packet count that includes other Missions as active work
- deletion of old packets as proof of cleanup

## 9. Decision Gates

Pause for owner/reviewer decision before:

- changing the active Mission pointer or per-Mission directory schema in a migration-relevant way
- treating historical session context as live evidence
- deleting packets, artifacts, ledgers, or Mission folders
- introducing HTTP/SSE, multi-host, daemon, or background worker behavior
- making Ghostty GUI automation a required gate
- changing role permissions or authority boundaries
- adding package install/publish flows

## 10. Open Questions For Spec

The implementation spec must resolve:

1. Exact `.pi/topology/` directory layout and active pointer semantics.
2. Mission ID format and registry fields.
3. State machines for Mission, Session, Task, Packet, Artifact, and Incident.
4. Resume criteria for Pi session IDs versus launch scripts versus local protocol evidence.
5. Packet stale marking and cleanup format.
6. Migration behavior from the current single `mission-card.json` shape.
7. How `/topology status`, footer/widget surfaces, and command output represent multi-Mission state.
8. Which Pi official APIs are supported, pending, compatibility targets, or local protocol.
