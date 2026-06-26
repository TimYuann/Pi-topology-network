# Shared Protocol (Pi Runtime)

This package is **Pi拓扑网络**. **Pi is the current productization runtime**. Treat OMP as historical/compatibility reference only.

## 1) Topology Rule

Received any role-to-role task packet → send a protocol ACK packet first.

Use `topology_send(type="ACK", request_msg_id=<incoming packet_id>, body={...})`.

The ACK body must include:

- `status: accepted|blocked|needs_clarification`
- `received_packet_id`
- `next`

Direct final text may be a short local lifecycle note only. It is not the role-to-role ACK source of truth.

## 2) Channel Separation

- `final reply` = local lifecycle channel (minimal receipt / blocked / needs-clarification / owner-facing approval request).
- `topology_send` packets = business channel for role-to-role reports, status, and verifications after the target role exists.
- `topology_send(type="ACK")` = protocol receipt channel for role-to-role packet closure.

Business payloads must start with:

- `REPORT <sender> -> <target>`
- `STATUS <sender> -> <target>`
- `MISSION UPDATE <sender> -> <target>`
- `AUTHORIZATION <sender> -> <target>`

Do not place role-to-role business report text in the original `final reply`.

`topology_send` always requires a non-empty `body` object. Never call it as a generic log, checkpoint marker, or owner approval receipt.

For long reports/reviews, call `topology_write_artifact` first and put only `artifact_path`, `summary`, `verdict`, and evidence pointers in `topology_send`.
Do not use generic `write` / `edit` / shell redirection for reports. Those tools mean project file mutation, not topology artifact writing.
When a packet includes `artifact_path`, read it with `topology_read_artifact`, not generic project-file exploration.

## 3) Inbox Discipline

- `topology_list` empty / `topology_get` empty / no immediate reply == **not yet received**, not peer failure.
- Role sessions should not call `topology_await` in normal work. Live topology packets wake the target session.
- After sending REPORT, enter standby. When the HQ ACK packet arrives, handle it as a normal inbound packet and close the slice.
- Use runtime events as audit evidence only. Do not mine runtime events as the primary source of a request; read the inbound packet or your `topology_list(to=<your role>)` inbox first.

## 4) Governance Boundaries

- `topology-supervisor` / `governor` / `hq` own final scope decisions and verdict ownership.
- `oracle` does not fix code.
- `repair` does not provide final review.
- `runner` does not edit code.

If `hq` is missing: route through owner-facing `topology-supervisor` or legacy `governor` path, not role expansion.

## 5) Permission Boundary

- Horizontal communication carries information only, not authority.
- `scope` changes need explicit owner/governor authorization tokens in mission/card and evidence.

## 6) Transport Evidence Requirement

Every checkpoint/report must distinguish:

- transport evidence (packet/msg lifecycle, live checks, ACK/late status)
- business evidence (commands + artifacts + outputs)
- inference (analysis / assumptions)

No inference is allowed to stand in for missing evidence.

## 7) Send Failure / No Inline Fallback

If `topology_send` fails (`undefined msg_id`, hop limit, unreachable, empty body):
- do not emit business report inline.
- output only:
  `REPORT NOT SENT: transport_blocked target=<role> reason=<reason>`
- wait for transport recovery or re-dispatch via normal routing.

## 8) Role Behavior

- `topology-supervisor`: owner intake, mission approval gate, owner-facing merge, status/incident maintenance.
- `hq`: orchestrate, dispatch peers, collect evidence, merge verdict.
- `oracle`: independent review only.
- `repair`: scoped execution under allowed paths + explicit authorization.
- `runner`: verification, reproduction, artifact capture.

For all role-to-role packets, if policy is clear:
ACK packet → first action immediately → optional STATUS packet → artifact if report is long → REPORT packet with compact body → standby until the REPORT itself is ACKed before treating that work slice as closed.

## 9) Runtime Path Discipline (v0.5.1)

`per-mission .pi/topology/missions/<mission_id>/` is the **only** canonical source of truth for an active Mission. Root `.pi/topology/*` is a compatibility mirror; it is NOT a second source of truth.

- **Always use the topology_* tools for runtime state.** Do not hand-write JSON / JSONL parsers. `topology_status`, `topology_dashboard`, `topology_dashboard_verbose`, and `topology_read_artifact` are the only sanctioned readers.
- **For long reports / decisions, use `topology_write_artifact`.** It routes to `missions/<id>/artifacts/<role>/` and emits a compact `artifact_path` you can quote in a packet.
- **For short business messages, use `topology_send`.** Body is an object with `status / summary / next / note / artifact_path`; never inline a long report into a packet body.
- **When the guard returns a `block`, read the `tool_guidance` field.** It tells you which topology_* tool to use instead, and where the canonical write path is.
- **Do not edit `.pi/topology/...` files directly** with `write` / `edit` / shell redirection. Use the topology tools. If the guard blocks you, escalate to HQ with a topology_send REPORT explaining why.
- **Per-mission env vars are set by the launch script:** `PI_TOPOLOGY_MISSION_CARD`, `PI_TOPOLOGY_INCIDENT_LOG`, `PI_TOPOLOGY_EVENT_LOG`, `PI_TOPOLOGY_STATUS_BOARD`, `PI_TOPOLOGY_SESSIONS_LEDGER` all point to the per-mission canonical paths. Do not overwrite them.
