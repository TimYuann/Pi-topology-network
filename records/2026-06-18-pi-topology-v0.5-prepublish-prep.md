# Pi Topology v0.5 Pre-Publish Prep

date: 2026-06-18
owner decision: version bump and release notes allowed; push / publish explicitly deferred
scope: docs + package metadata only

## Decision

The owner approved the v0.5 pre-publish preparation items:

- bump package version from `0.1.0` to `0.5.0`
- add package-level `CHANGELOG.md`
- add package-level `RELEASE-NOTES.md`
- clean the final review hotfix count inconsistency

The owner explicitly deferred:

- `git push`
- `npm publish`
- release tagging

Local production testing will run for roughly one week before any remote release action.

## Changed Files

- `packages/pi-topology/package.json`
  - `version`: `0.5.0`
  - npm `files` whitelist now includes `CHANGELOG.md` and `RELEASE-NOTES.md`
- `packages/pi-topology/CHANGELOG.md`
  - v0.5.0 implementation summary, fixes, validation, deferred scope
- `packages/pi-topology/RELEASE-NOTES.md`
  - owner-facing release notes and publish gate statement
- `records/2026-06-17-pi-topology-v0.5-final-deep-review.md`
  - hotfix count normalized to 11 throughout the final review record

## Release Boundary

This prep makes the local package ready for a future release decision, but it is not itself a publish event. The current state remains local-only until the owner explicitly authorizes push / publish.
