#!/usr/bin/env bash
set -euo pipefail

ROLE="${1:-hq}"
case "$ROLE" in
  hq|repair|runner|oracle|librarian|scott) ;;
  *)
    echo "Usage: $0 <hq|repair|runner|oracle|librarian|scott>" >&2
    exit 2
    ;;
esac

ROOT="/Users/yuantian/Documents/Coding/omp-topology-network"
PKG="$ROOT/packages/pi-topology"
RUN_ROOT="${PI_TOPOLOGY_RUN_ROOT:-/tmp/pi-topology-dogfood}"
WORKDIR="$RUN_ROOT/workdir"
LOG_DIR="$RUN_ROOT/logs"
LOG_FILE="$LOG_DIR/${ROLE}-smoke.log"
MISSION="$WORKDIR/.pi/topology/mission-card.json"

mkdir -p "$WORKDIR" "$LOG_DIR"

export PI_COMS_DIR="$RUN_ROOT/coms"
export PI_TOPOLOGY_PROJECT="pi-topology-dogfood"
export PI_TOPOLOGY_MISSION_ID="pi-topology-dogfood-2026-06-15-001"
export PI_TOPOLOGY_MISSION_CARD="$MISSION"
export PI_OFFLINE="${PI_OFFLINE:-0}"
export PI_PROVIDER="${PI_PROVIDER:-minimax-cn}"
export PI_MODEL="${PI_MODEL:-MiniMax-M3}"
export PI_THINKING="${PI_THINKING:-low}"

PI_MODEL_ARGS=()
if [[ "$PI_OFFLINE" == "1" ]]; then
  PI_MODEL_ARGS+=(--offline)
else
  PI_MODEL_ARGS+=(--provider "$PI_PROVIDER" --model "$PI_MODEL" --thinking "$PI_THINKING")
fi

cd "$WORKDIR"

{
  echo "== pi-topology ghostty role smoke =="
  date -u +"started_at=%Y-%m-%dT%H:%M:%SZ"
  echo "role=$ROLE"
  echo "pkg=$PKG"
  echo "workdir=$WORKDIR"
  echo "mission=$MISSION"
  echo "PI_COMS_DIR=$PI_COMS_DIR"
  echo "offline=$PI_OFFLINE"
  echo "provider=$PI_PROVIDER"
  echo "model=$PI_MODEL"
  echo "thinking=$PI_THINKING"
  echo
  pi \
    -e "$PKG/index.ts" \
    --no-builtin-tools \
    --tools topology_status,topology_doctor,topology_smoke,topology_send,topology_get,topology_list \
    "${PI_MODEL_ARGS[@]}" \
    --cname "$ROLE" \
    --project pi-topology-dogfood \
    --append-system-prompt "$PKG/agents/shared-protocol.md" \
    --append-system-prompt "$PKG/agents/$ROLE.md" \
    --append-system-prompt "$MISSION" \
    --name "pi-topology dogfood $ROLE" \
    -p "You are the $ROLE role in a real Ghostty Pi smoke for pi-topology. Start with a direct ACK in final text. Call topology_status exactly once, then topology_doctor exactly once. If your role is hq, call topology_send exactly once with a non-empty REQUEST body to runner. If runner, repair, oracle, librarian, or scott, call topology_send exactly once with a non-empty STATUS or REPORT body to hq containing concise evidence fields. Do not call topology_send more than once. Do not call topology_list in this smoke. After the required tool calls, stop using tools and give one concise final answer with the role name, packet id if any, and whether tools ran."
  echo
  date -u +"finished_at=%Y-%m-%dT%H:%M:%SZ"
} 2>&1 | tee "$LOG_FILE"

echo
echo "Log written to $LOG_FILE"
if [[ "${PI_TOPOLOGY_WAIT_ON_EXIT:-0}" == "1" && -t 0 ]]; then
  echo "Press Enter to close this Ghostty role smoke window."
  read -r _
fi
