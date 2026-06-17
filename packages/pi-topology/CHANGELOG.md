# Changelog

## 0.5.0 - 2026-06-18

### Added

- Per-mission topology runtime layout under `.pi/topology/`, including mission registry, active mission pointer, mission cards, status boards, runtime events, incident logs, session ledgers, packet ledgers, artifacts, and generated launch scripts.
- Supervisor mission picker and lifecycle actions for intake, selection, archiving, restoring, abandoning, and continuing missions.
- Role session tracking with liveness classification, resumability windows, stale detection, and role summary recomputation from session ledgers.
- Packet lifecycle support for actionable inbox items, ACK/report closure semantics, stale packet marking, and active-mission filtering.
- Per-mission dashboard and widget snapshots for Pi command surfaces.
- Legacy single-mission migration into the v0.5 per-mission layout.
- Dogfood runtime harness with deterministic Pi stub cleanup evidence.

### Changed

- `/topology` now acts as the primary mission entrypoint: it routes to the active mission dashboard, legacy migration prompt, or new mission preflight depending on workspace state.
- Generated launch plans now carry explicit role permissions, provider/model defaults, script paths, and owner-gate metadata.
- Publish package metadata now aligns with the v0.5 implementation contract.

### Fixed

- Closed all reviewer-tracked P0/P1/P2 findings across the 7-slice roadmap and 11 hotfix patches.
- Hardened active mission validation, unsafe mission IDs, path escapes, stale liveness classification, packet recipient/actionability checks, invalid active pointers, and dogfood temp cleanup.

### Validation

- `npm run smoke`: 297/297 unit tests pass, typecheck pass, `npm pack --dry-run` clean.
- `npm run dogfood`: 1/1 integration test pass in the recorded readiness evidence.
- Local production testing is planned before any push or publish.

### Deferred

- v0.6 hardening items are parked in `docs/15-pi-topology-mission-runtime-v0.6-hardening-notes.md` and are not part of the v0.5 release scope.
