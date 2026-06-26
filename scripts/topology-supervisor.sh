#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'USAGE'
usage: scripts/topology-supervisor.sh [--print|--launch|--validate-only] [--stagger SECONDS] --mission PATH [role ...]

Prints or launches Pi topology role sessions from a Phase D mission card.
Default mode is --print. This script is a first supervisor skeleton: it prepares
consistent Pi commands, shared protocol injection, role prompts, coms registry,
and damage-control extension wiring. It does not replace the future in-process
Pi topology-runtime extension.

roles default to: hq
available roles: hq repair runner oracle
USAGE
}

MODE=print
MISSION=""
STAGGER=1
ROLES=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --print) MODE=print; shift ;;
    --launch) MODE=launch; shift ;;
    --validate-only) MODE=validate; shift ;;
    --stagger) STAGGER="${2:-}"; shift 2 ;;
    --mission) MISSION="${2:-}"; shift 2 ;;
    --help|-h) usage; exit 0 ;;
    *) ROLES+=("$1"); shift ;;
  esac
done

if [[ -z "$MISSION" ]]; then
  usage
  exit 2
fi
if [[ ! -f "$MISSION" ]]; then
  echo "mission card not found: $MISSION" >&2
  exit 2
fi
MISSION="$(cd "$(dirname "$MISSION")" && pwd)/$(basename "$MISSION")"
if [[ "${#ROLES[@]}" -eq 0 ]]; then
  ROLES=(hq)
fi

HARNESS_ROOT="${PI_TOPOLOGY_HARNESS_ROOT:-/Users/yuantian/Documents/Coding/pi-vs-cc}"
if [[ ! -d "$HARNESS_ROOT" ]]; then
  echo "Pi harness root not found: $HARNESS_ROOT" >&2
  exit 2
fi
if ! command -v pi >/dev/null 2>&1; then
  echo "warning: pi command not found in PATH; --print still works, --launch will fail" >&2
fi

read_json() {
  /usr/bin/python3 - "$MISSION" "$1" <<'PY'
import json
import sys
path, key = sys.argv[1:3]
with open(path, "r", encoding="utf-8") as f:
    data = json.load(f)
value = data
for part in key.split("."):
    if isinstance(value, dict):
        value = value.get(part)
    else:
        value = None
        break
if value is None:
    print("")
elif isinstance(value, (dict, list)):
    print(json.dumps(value, ensure_ascii=False))
else:
    print(value)
PY
}

MISSION_ID="$(read_json mission_id)"
PROJECT="$(read_json project)"
WORKDIR="$(read_json workdir)"
if [[ -z "$MISSION_ID" || -z "$PROJECT" || -z "$WORKDIR" ]]; then
  echo "mission card must include mission_id, project, workdir" >&2
  exit 2
fi
if [[ ! -d "$WORKDIR" ]]; then
  echo "workdir does not exist: $WORKDIR" >&2
  exit 2
fi

REGISTRY="${PI_COMS_DIR:-/tmp/pi-topology-${PROJECT}}"
GHOSTTY_APP_NAME="${GHOSTTY_APP_NAME:-Ghostty}"
TMP_DIR="${TMPDIR:-/tmp}/pi-topology-supervisor-${PROJECT}"
mkdir -p "$TMP_DIR"
SHARED_PROTOCOL="$HARNESS_ROOT/.pi/agents/pi-topology-network/shared-protocol.md"
COMS_EXT="$HARNESS_ROOT/extensions/coms.ts"
DAMAGE_EXT="$HARNESS_ROOT/extensions/damage-control-continue.ts"
THEME_EXT="$HARNESS_ROOT/extensions/theme-cycler.ts"
for required in "$SHARED_PROTOCOL" "$COMS_EXT" "$DAMAGE_EXT" "$THEME_EXT"; do
  if [[ ! -f "$required" ]]; then
    echo "required Pi topology file missing: $required" >&2
    exit 2
  fi
done

role_file() {
  case "$1" in
    hq|repair|runner|oracle) printf "%s/.pi/agents/pi-topology-network/%s.md\n" "$HARNESS_ROOT" "$1" ;;
    *) echo "unknown role: $1" >&2; exit 2 ;;
  esac
}

purpose() {
  case "$1" in
    hq) printf "Development HQ for Pi topology mission %s\n" "$MISSION_ID" ;;
    repair) printf "Scoped repair executor for Pi topology mission %s\n" "$MISSION_ID" ;;
    runner) printf "Verification runner for Pi topology mission %s\n" "$MISSION_ID" ;;
    oracle) printf "Independent reviewer for Pi topology mission %s\n" "$MISSION_ID" ;;
  esac
}

provider_for() {
  case "$1" in
    oracle) printf "openai\n" ;;
    hq|repair|runner) printf "minimax-cn\n" ;;
  esac
}

model_for() {
  case "$1" in
    oracle) printf "gpt-5.5\n" ;;
    hq|repair|runner) printf "MiniMax-M3\n" ;;
  esac
}

for role in "${ROLES[@]}"; do
  prompt="$(role_file "$role")"
  if [[ ! -f "$prompt" ]]; then
    echo "role prompt not found: $prompt" >&2
    exit 2
  fi
  if [[ "$MODE" == "validate" ]]; then
    printf "validated role=%s prompt=%s\n" "$role" "$prompt"
    continue
  fi
  provider="$(provider_for "$role")"
  model="$(model_for "$role")"
  script="$TMP_DIR/${role}.sh"
  cat > "$script" <<SCRIPT
#!/usr/bin/env bash
set -euo pipefail
cd "$WORKDIR"
export PI_COMS_DIR="$REGISTRY"
export PI_TOPOLOGY_PROJECT="$PROJECT"
export PI_TOPOLOGY_MISSION_ID="$MISSION_ID"
export PI_TOPOLOGY_MISSION_CARD="$MISSION"
export PI_TOPOLOGY_HARNESS_ROOT="$HARNESS_ROOT"
printf "\\033]0;pi-$PROJECT-$role\\007"
printf "Starting %s for mission %s\\n" "$role" "$MISSION_ID"
printf "WORKDIR=%s\\n" "$WORKDIR"
printf "PI_COMS_DIR=%s\\n" "\$PI_COMS_DIR"
exec pi \\
  -e "$COMS_EXT" \\
  -e "$DAMAGE_EXT" \\
  -e "$THEME_EXT" \\
  --provider "$provider" \\
  --model "$model" \\
  --cname "$role" \\
  --project "$PROJECT" \\
  --purpose "$(purpose "$role")" \\
  --append-system-prompt "$SHARED_PROTOCOL" \\
  --append-system-prompt "$prompt" \\
  --append-system-prompt "$MISSION"
SCRIPT
  chmod +x "$script"

  printf "# %s (%s/%s)\n" "$role" "$provider" "$model"
  printf "PI_COMS_DIR=%q open -n -a %q --args -e %q\n\n" "$REGISTRY" "$GHOSTTY_APP_NAME" "$script"

  if [[ "$MODE" == "launch" ]]; then
    PI_COMS_DIR="$REGISTRY" open -n -a "$GHOSTTY_APP_NAME" --args -e "$script"
    sleep "$STAGGER"
  fi
done

if [[ "$MODE" == "validate" ]]; then
  printf "validated mission_id=%s project=%s workdir=%s registry=%s\n" "$MISSION_ID" "$PROJECT" "$WORKDIR" "$REGISTRY"
fi
