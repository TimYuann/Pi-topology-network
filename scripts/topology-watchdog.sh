#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'USAGE'
usage: scripts/topology-watchdog.sh --status PATH --incidents PATH [--now ISO8601] [--json]

Reads a Phase D status board and incident log, then prints a watchdog checklist.
This first version is observability-only: it does not send coms messages, kill
processes, or edit business files.
USAGE
}

STATUS=""
INCIDENTS=""
NOW=""
OUTPUT=json-no

while [[ $# -gt 0 ]]; do
  case "$1" in
    --status) STATUS="${2:-}"; shift 2 ;;
    --incidents) INCIDENTS="${2:-}"; shift 2 ;;
    --now) NOW="${2:-}"; shift 2 ;;
    --json) OUTPUT=json; shift ;;
    --help|-h) usage; exit 0 ;;
    *) echo "unknown arg: $1" >&2; usage; exit 2 ;;
  esac
done

if [[ -z "$STATUS" || -z "$INCIDENTS" ]]; then
  usage
  exit 2
fi
if [[ ! -f "$STATUS" ]]; then
  echo "status board not found: $STATUS" >&2
  exit 2
fi
if [[ ! -f "$INCIDENTS" ]]; then
  echo "incident log not found: $INCIDENTS" >&2
  exit 2
fi

/usr/bin/python3 - "$STATUS" "$INCIDENTS" "$NOW" "$OUTPUT" <<'PY'
import json
import sys
from datetime import datetime, timezone

status_path, incidents_path, now_arg, output_mode = sys.argv[1:5]

def parse_dt(value):
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except Exception:
        return None

with open(status_path, "r", encoding="utf-8") as f:
    board = json.load(f)

incidents = []
with open(incidents_path, "r", encoding="utf-8") as f:
    for line in f:
        line = line.strip()
        if not line:
            continue
        try:
            item = json.loads(line)
        except Exception:
            item = {"event_type": "parse_error", "raw": line}
        if item.get("event_type") != "schema":
            incidents.append(item)

now = parse_dt(now_arg) if now_arg else datetime.now(timezone.utc)
mission_id = board.get("mission_id", "?")
phase = board.get("runtime_phase") or board.get("phase") or "?"
checkpoint_due = parse_dt(board.get("next_checkpoint_due_at"))
last_checkpoint = parse_dt(board.get("last_checkpoint_at"))
pending_packets = board.get("pending_packets") or []
peer_status = board.get("peer_status") or {}
next_gate = board.get("next_gate") or {}
context_health = board.get("context_health") or {}
high = context_health.get("high_watermark_pct", 80)

findings = []

if checkpoint_due and now > checkpoint_due:
    findings.append(("checkpoint_overdue", f"next checkpoint due at {checkpoint_due.isoformat()}"))
elif last_checkpoint is None:
    findings.append(("checkpoint_missing", "last_checkpoint_at is empty"))

for packet in pending_packets:
    sla = parse_dt(packet.get("deadline_at") or packet.get("sla_due_at"))
    if sla and now > sla:
        findings.append(("packet_overdue", f"{packet.get('packet_id') or packet.get('msg_id') or '?'} exceeded SLA"))

for role, state in peer_status.items():
    if state.get("alive") is False:
        findings.append(("peer_not_alive", role))
    pct = state.get("context_used_pct")
    if isinstance(pct, (int, float)) and pct >= high:
        findings.append(("context_high", f"{role} at {pct}%"))

if next_gate.get("owner_required"):
    findings.append(("owner_gate", next_gate.get("reason") or next_gate.get("type") or "owner decision required"))

if output_mode == "json":
    print(json.dumps({
        "mission_id": mission_id,
        "phase": phase,
        "now": now.isoformat(),
        "status_board": status_path,
        "incident_log": incidents_path,
        "findings": [{"type": kind, "detail": detail} for kind, detail in findings],
        "incident_count": len(incidents),
        "summary_status": "attention_required" if findings else "ok"
    }, ensure_ascii=False, indent=2))
    raise SystemExit(0)

print(f"Topology Watchdog")
print(f"mission_id: {mission_id}")
print(f"phase: {phase}")
print(f"now: {now.isoformat()}")
print(f"status_board: {status_path}")
print(f"incident_log: {incidents_path}")
print("")
print("Findings:")
if findings:
    for kind, detail in findings:
        print(f"- {kind}: {detail}")
else:
    print("- none")
print("")
print("Checklist:")
print("- confirm hq is not blocked in long coms_await")
print("- confirm workers report via REPORT/STATUS business packets")
print("- confirm owner gates are paused, not bypassed")
print("- confirm damage-control blocks are reflected in incidents")
print("- confirm next checkpoint time is explicit")
print("")
print(f"incident_count: {len(incidents)}")
PY
