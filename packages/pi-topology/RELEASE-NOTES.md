# pi-topology-network v0.5.0 Release Notes

Date: 2026-06-18
Status: local pre-publish package prepared; not pushed or published.

v0.5.0 is the first normalized implementation-contract release of the Pi topology runtime. It turns the earlier topology prototype work into a package-shaped runtime with per-mission state, resumable role sessions, packet-first coordination, dashboard snapshots, migration support, and dogfood evidence.

## Highlights

- Per-mission state directory: `.pi/topology/missions/<mission_id>/`
- Mission registry and active mission pointer
- Supervisor picker and mission lifecycle actions
- Role liveness and resumability classification
- Packet ledger cleanup, actionable filtering, and stale marking
- Per-mission dashboard and Pi UI snapshot
- Legacy root-layout migration
- Direct generated-script launch support for local dogfood testing

## Scope

This release completes the v0.5 PRD/spec roadmap:

- 7 main implementation slices
- 11 reviewer hotfix patches
- 297 unit tests
- 1 dogfood integration test
- Smoke, typecheck, and pack dry-run validation

## Publish Gate

The package is intentionally not pushed or published yet. The owner will run local production testing for one week before deciding whether to push, tag, or publish.

## Known Deferred Work

The v0.6 hardening backlog is parked separately and remains out of v0.5 scope. It covers deeper invariants, recovery rules, schema completeness, and edge-case precedence audits.
