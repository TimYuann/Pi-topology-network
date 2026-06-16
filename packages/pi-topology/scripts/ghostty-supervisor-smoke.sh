#!/usr/bin/env bash
set -euo pipefail

ROOT="/Users/yuantian/Documents/Coding/omp-topology-network"
PKG="$ROOT/packages/pi-topology"
RUN_ROOT="${PI_TOPOLOGY_RUN_ROOT:-/tmp/pi-topology-dogfood}"
WORKDIR="$RUN_ROOT/workdir"
LOG_DIR="$RUN_ROOT/logs"
LOG_FILE="$LOG_DIR/supervisor-smoke.log"
SPAWN_MODE="${PI_TOPOLOGY_SPAWN_MODE:-${SPAWN_MODE:-launch}}"

mkdir -p "$WORKDIR" "$LOG_DIR"

export PI_COMS_DIR="$RUN_ROOT/coms"
export PI_TOPOLOGY_PROJECT="pi-topology-dogfood"
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
  echo "== pi-topology ghostty supervisor smoke =="
  date -u +"started_at=%Y-%m-%dT%H:%M:%SZ"
  echo "pkg=$PKG"
  echo "workdir=$WORKDIR"
  echo "PI_COMS_DIR=$PI_COMS_DIR"
  echo "offline=$PI_OFFLINE"
  echo "provider=$PI_PROVIDER"
  echo "model=$PI_MODEL"
  echo "thinking=$PI_THINKING"
  echo "spawn_mode=$SPAWN_MODE"
  echo
  pi \
    -e "$PKG/index.ts" \
    --no-builtin-tools \
    --tools topology_status,topology_doctor,topology_smoke,topology_init_mission,topology_spawn_role,topology_send,topology_get,topology_list \
    "${PI_MODEL_ARGS[@]}" \
    --cname topology-supervisor \
    --project pi-topology-dogfood \
    --name "pi-topology dogfood supervisor" \
    -p "You are testing the installed pi-topology package. First call topology_status. If there is no mission card, call topology_init_mission with objective 'Ghostty real Pi smoke for pi-topology package', project 'pi-topology-dogfood', and allowed_paths ['$WORKDIR']. Then call topology_status and topology_doctor. Send a STATUS packet from hq to runner using topology_send. Finally call topology_spawn_role with role 'hq', mode '$SPAWN_MODE', terminal_app 'Ghostty.app', initial_prompt 'ACK hq: spawned by topology-supervisor. Call topology_status, topology_doctor, topology_send a STATUS packet to runner, then topology_list for hq.', and log_path '$LOG_DIR/hq-spawned.log'. The spawned role launch plan is locked by the tool to provider minimax-cn, model MiniMax-M3, and thinking low; do not pass provider/model/thinking to topology_spawn_role. Keep the final answer concise and include which topology tools ran plus whether HQ launch was requested."
  echo
  date -u +"finished_at=%Y-%m-%dT%H:%M:%SZ"
} 2>&1 | tee "$LOG_FILE"

echo
echo "Log written to $LOG_FILE"
if [[ "${PI_TOPOLOGY_WAIT_ON_EXIT:-0}" == "1" && -t 0 ]]; then
  echo "Press Enter to close this Ghostty smoke window."
  read -r _
fi
