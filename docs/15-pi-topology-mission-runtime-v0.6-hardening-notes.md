# Pi Topology Mission Runtime v0.6 Hardening Notes

Date: 2026-06-17
Project: OMP拓扑网络 / `packages/pi-topology`
Status: forward-looking notes; not a PRD; not an implementation spec
Depends on: `docs/13-pi-topology-mission-runtime-prd.md` v0.5 and `docs/14-pi-topology-mission-runtime-spec.md` v0.5

## 1. Purpose

v0.5 normalized the Mission Runtime into an implementation contract and completed the 7-slice roadmap: Mission registry, per-Mission storage, mission picker, session classification, packet cleanup, dashboard, migration, and final dogfood acceptance.

v0.6 should not reopen v0.5 scope casually. Its theme should be implementation-safety hardening:

```text
v0.6 = Make Mission Runtime implementation-safe
       by adding invariants, schemas, write ordering, recovery rules,
       and edge-case precedence.
```

This document is a parking lot and planning reference for a future v0.6. It is not a release blocker for v0.5 unless a listed issue is later proven to cause current-version data corruption, permission leakage, or false acceptance evidence.

## 2. Recommended v0.6 Priorities

### 2.1 Canonical Write And Root Mirror Invariants

Once `mission-registry.json` exists, canonical Mission state should live under:

```text
.pi/topology/missions/<mission_id>/
```

Root compatibility files should be exact mirrors for the active Mission only, never mixed ledgers from multiple Missions.

v0.6 should define mirror sync invariants such as:

```text
root runtime-events.jsonl == active Mission runtime-events.jsonl
root incident-log.jsonl == active Mission incident-log.jsonl
root sessions.jsonl == active Mission sessions.jsonl
```

On active Mission switch, the runtime should append a selection event, update registry and pointer, rebuild root mirrors from the selected canonical folder, and refresh root launch scripts.

### 2.2 Active Mission Guard In Generated Launch Scripts

Generated launch scripts should embed:

- `embedded_mission_id`
- `embedded_role`
- `embedded_policy_hash`
- `embedded_script_generation_event_id`

Before starting, each script should verify that `active-mission.json.active_mission_id` matches the embedded Mission id. If it does not match, the script should exit non-zero, print a clear inactive-Mission warning, and append `launch_blocked` evidence when writable.

### 2.3 Resume Classification Precedence Audit

v0.5 already corrected key freshness and terminal-state issues during slices 3 and 3.1. v0.6 should still codify the intended precedence:

1. Mission terminal state closes roles for normal dispatch.
2. Latest role `closed` record wins.
3. Owner/runtime parked role wins over transport liveness.
4. Latest role `failed` record prevents blind resume.
5. Fresh heartbeat or equivalent proof means `live`.
6. Recent `alive_confirmed` without fresh liveness means `resumable`.
7. Valid launch script means `resumable(needs_liveness_confirmation)`.
8. Historical evidence without freshness means `stale`.
9. No evidence means `planned`.

The rule is: owner/runtime lifecycle decisions override transport evidence.

### 2.4 Overlay States For Blocked, Parked, And Rollback Pending

`blocked`, `parked`, and `rollback_pending` are interrupt or attention states, not ordinary lifecycle phases. v0.6 should consider replacing a single `lifecycle_state` overload with:

```json
{
  "lifecycle_phase": "reviewing",
  "attention_state": "blocked",
  "gate_required": "reviewer"
}
```

If the single-field model remains, interrupted state must be preserved:

```json
{
  "lifecycle_state": "blocked",
  "interrupted_from": "reviewing",
  "blocked_reason": "...",
  "gate_required": "owner|reviewer|both"
}
```

### 2.5 File Write Transaction Protocol

v0.6 should define the local file runtime's minimum write protocol:

- JSON state files write to temporary path, then atomic rename.
- JSONL ledgers append one complete line and never rewrite existing rows.
- JSONL records include `schema_version` and stable record ids.
- Multi-file mutation order is canonical event, canonical state, registry summary, root mirror.

Crash recovery rules should be explicit:

- Event exists but materialized state is stale: startup reconciliation may update state from the latest event.
- Materialized state changed but event is missing: reviewer finding; runtime should write an incident on next load.
- Root mirror diverges from canonical: rebuild mirror and write `mirror_repaired` evidence.

### 2.6 Split Business Writes From Runtime Evidence Writes

v0.5 launch metadata uses a single write policy. v0.6 should split permission semantics:

```json
{
  "business_write_policy": "deny_all_writes",
  "business_allowed_paths": [],
  "runtime_state_write_policy": "role_scoped_artifacts_only",
  "runtime_allowed_paths": [
    ".pi/topology/missions/<mission_id>/artifacts/<role>/",
    ".pi/topology/missions/<mission_id>/sessions.jsonl",
    ".pi/topology/missions/<mission_id>/runtime-events.jsonl"
  ]
}
```

This keeps Runner, Oracle, Librarian, and Scott read-only for business code while still allowing durable evidence production.

### 2.7 Launch Metadata Files And Policy Hashes

v0.6 should persist launch metadata next to launch scripts, for example:

```text
missions/<mission_id>/launch/<role>.sh
missions/<mission_id>/launch/<role>.metadata.json
```

Metadata should include:

- policy snapshot
- `policy_hash`
- `generated_by_event_id`
- `generated_at`
- active Mission guard enabled flag

The dashboard should warn when a role was launched under policy hash A but the current Mission policy is hash B.

### 2.8 Unified Event Envelope

v0.6 should define a common event envelope reused across runtime events, sessions, packet ledger, incident log, and future decision ledgers:

```json
{
  "schema_version": 1,
  "event_id": "evt_...",
  "event_type": "mission_lifecycle_transition",
  "mission_id": "mission_...",
  "entity_type": "mission|session|packet|artifact|incident|registry",
  "entity_id": "...",
  "actor": {
    "kind": "owner|supervisor|hq|runner|oracle|repair|librarian|scott|runtime",
    "id": "..."
  },
  "created_at": "...",
  "correlation_id": "corr_...",
  "slice_id": "slice_...",
  "from_state": "...",
  "to_state": "...",
  "reason": "...",
  "evidence": {
    "transport": [],
    "business": [],
    "inference": []
  }
}
```

### 2.9 Evidence Index Schema

The v0.5 target layout reserves `evidence-index.jsonl`. v0.6 should define its schema:

```json
{
  "schema_version": 1,
  "evidence_id": "ev_...",
  "mission_id": "mission_...",
  "kind": "test_log|smoke_log|review_note|artifact|terminal_log|packet|diff|closeout",
  "mission_path": "mission:<mission_id>/artifacts/runner/smoke.log",
  "filesystem_path": ".pi/topology/missions/<mission_id>/artifacts/runner/smoke.log",
  "produced_by_role": "runner",
  "referenced_by_event_id": "evt_...",
  "correlation_id": "corr_...",
  "digest": "sha256:...",
  "created_at": "...",
  "status": "draft|referenced|reviewed|accepted|superseded|archived"
}
```

### 2.10 Mission ID Grammar

v0.5 has path-safety validation. v0.6 should define a formal Mission id grammar, collision retries, and migration policy. A candidate format:

```text
mission_<yyyymmddTHHMMSSZ>_<slug>_<random6>
```

Requirements:

- lowercase
- path-safe
- immutable
- max 96 chars
- not derived solely from title
- collision retries required

### 2.11 Packet Ledger Raw Source Provenance

v0.6 should add raw source provenance to packet-ledger records:

```json
{
  "raw_transport_line": 128,
  "raw_transport_offset": 54291,
  "raw_record_digest": "sha256:...",
  "classification_event_id": "evt_...",
  "classified_by": "runtime|librarian|supervisor",
  "legacy_mission_resolution": "exact|inferred|unknown"
}
```

Packets without `mission_id` should never count as active by default. They may be shown as `historical_unknown_mission` or associated only through an explicit inference event.

### 2.12 Decision Ledger

v0.6 should define a Mission-local decision log:

```text
missions/<mission_id>/decision-log.jsonl
```

Candidate schema:

```json
{
  "schema_version": 1,
  "decision_id": "dec_...",
  "mission_id": "mission_...",
  "decision_type": "owner_gate|reviewer_gate|both",
  "subject": "archive|rollback|permission_change|delete_evidence|schema_migration",
  "decision": "approved|rejected|deferred",
  "actor": "owner|reviewer",
  "reason": "...",
  "evidence_refs": [],
  "created_at": "..."
}
```

This would make owner/reviewer gates inspectable without relying only on free-form runtime events.

### 2.13 Complete Reverse Transition Matrix

v0.6 should fill reverse and recovery transitions:

- `mission_blocked`: any non-terminal state to blocked attention state.
- `mission_unblocked`: blocked to interrupted phase.
- `mission_unparked`: parked to interrupted phase or owner confirmation.
- `rollback_decided_repair`: rollback pending to running or blocked.
- `rollback_decided_abandon`: rollback pending to abandoned.
- `mission_abandoned`: any non-archived state to abandoned.
- `mission_reopened`: delivered to running or reviewing only with owner and reviewer gate.

Terminal rules should also be explicit:

- `archived` is terminal for work dispatch.
- `abandoned` may be archived.
- `delivered` can archive, inspect, or reopen only through explicit gate.

### 2.14 Legacy Adapter Versus Full Migration

v0.5 implemented compatibility reading plus full migration. v0.6 should document that split more formally:

- Legacy adapter: read root files through helpers without rewriting storage.
- Full migration: create per-Mission folder, registry, pointer, mirrors, and migration evidence.

This avoids requiring destructive migration just to inspect or resume older workspaces.

### 2.15 Migration Backup, Manifest, And Ordering

v0.6 should add a migration manifest:

```text
.pi/topology/migrations/<migration_id>.json
```

The manifest should record copied files, missing files, created files, checksums, event ids, inferred-empty rows, and completion status.

Preferred full migration order:

1. Detect legacy layout.
2. Create migration manifest or backup.
3. Copy root files into canonical Mission folder.
4. Create inferred-empty files where needed.
5. Append inferred-empty rows.
6. Append `mission_migrated` event.
7. Write registry.
8. Write active Mission pointer referencing migration event.
9. Rebuild root mirrors from canonical folder.
10. Write migration completion summary.

### 2.16 UI Snapshot Contract

v0.6 should include stable examples for `/topology` and `/topology status` output so implementer and reviewer expectations do not drift.

Example:

```text
Active Mission
  id: mission_...
  state: running
  owner gate: clear
  next: confirm Runner liveness before dispatch

Roles
  live: hq
  resumable: runner(needs_liveness_confirmation)
  stale: oracle
  parked: librarian
  closed: none

Packets
  active: 2
  stale historical: 4

Evidence
  latest closeout: mission:.../closeout.md
```

## 3. Recommended Opening Order For v0.6

When v0.6 starts, do not implement all items at once. Suggested slices:

1. Root mirror invariants and active launch-script guard.
2. File write transaction helpers and crash recovery checks.
3. Permission split plus launch metadata policy hash.
4. Event envelope and decision ledger.
5. Evidence index and packet raw provenance.
6. Migration manifest and UI snapshot contract.

## 4. Current v0.5 Release Impact

These notes do not block v0.5 release readiness.

v0.5 is accepted when its implemented slices pass review, dogfood, smoke, and documented evidence checks. v0.6 items become blockers only after they are promoted into a future PRD/spec or if a concrete v0.5 bug demonstrates data corruption, permission leakage, or false acceptance evidence.
