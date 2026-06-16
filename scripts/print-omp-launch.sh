#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="${1:-}"
PROJECT_NAME="${2:-}"
COMS_EXT="${OMP_COMS_EXT:-/Users/yuantian/.omp/agent/experiments/coms-omp}"

if [[ -z "$PROJECT_ROOT" || -z "$PROJECT_NAME" ]]; then
  echo "usage: scripts/print-omp-launch.sh /path/to/project project-name" >&2
  exit 2
fi

REGISTRY="/tmp/omp-topology-${PROJECT_NAME}"

cat <<OUT
cd "$PROJECT_ROOT"
export OMP_COMS_DIR="$REGISTRY"
export OMP_COMS_EXT="$COMS_EXT"

omp -e "\$OMP_COMS_EXT" --cname governor --purpose "Owner-facing governor. Must direct-ACK inbound messages and dispatch only to hq." --project "${PROJECT_NAME}-topology"
omp -e "\$OMP_COMS_EXT" --cname hq       --purpose "Development HQ. Must direct-ACK governor directives before planning or dispatching." --project "${PROJECT_NAME}-topology"
omp -e "\$OMP_COMS_EXT" --cname oracle   --purpose "Independent reviewer. Reviews evidence and risk; does not edit code." --project "${PROJECT_NAME}-topology"
omp -e "\$OMP_COMS_EXT" --cname repair   --purpose "Scoped repair executor. Edits only within hq-authorized scope." --project "${PROJECT_NAME}-topology"
omp -e "\$OMP_COMS_EXT" --cname runner   --purpose "Verification runner. Runs tests and records artifacts; does not edit code." --project "${PROJECT_NAME}-topology"
OUT
