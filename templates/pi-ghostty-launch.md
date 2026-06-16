# Pi Ghostty Launch

Pi harness project:

```text
/Users/yuantian/Documents/Coding/pi-vs-cc
```

The launcher separates harness root from workdir:

- Harness / extensions / role prompts: `/Users/yuantian/Documents/Coding/pi-vs-cc`
- Actual project cwd: pass with `--workdir`

## ekunCustomsWms

Safe default: print commands only.

```bash
cd /Users/yuantian/Documents/Coding/pi-vs-cc
./scripts/launch-pi-topology-ghostty.sh \
  --workdir /Users/yuantian/Documents/Coding/ekunCustomsWms \
  customs-long hq runner
```

Launch required roles in Ghostty:

```bash
cd /Users/yuantian/Documents/Coding/pi-vs-cc
./scripts/launch-pi-topology-ghostty.sh --launch \
  --workdir /Users/yuantian/Documents/Coding/ekunCustomsWms \
  customs-long hq runner
```

Launch all five roles in Ghostty, staggered:

```bash
cd /Users/yuantian/Documents/Coding/pi-vs-cc
./scripts/launch-pi-topology-ghostty.sh --launch --stagger 2 \
  --workdir /Users/yuantian/Documents/Coding/ekunCustomsWms \
  customs-long
```

## Model Routing

Default routing:

```text
governor -> openai/gpt-5.5
oracle   -> openai/gpt-5.5
hq       -> minimax-cn/MiniMax-M3
repair   -> minimax-cn/MiniMax-M3
runner   -> minimax-cn/MiniMax-M3
```

Override with environment variables:

```bash
PI_TOPOLOGY_PROVIDER_HQ=minimax-cn PI_TOPOLOGY_MODEL_HQ=MiniMax-M3 \
./scripts/launch-pi-topology-ghostty.sh --launch --workdir /path/to/project project hq
```

## Roles

```text
governor hq oracle repair runner
```

All launched sessions share:

```text
PI_COMS_DIR=/tmp/pi-topology-<project>
```

The launcher loads:

```text
/Users/yuantian/Documents/Coding/pi-vs-cc/extensions/coms.ts
/Users/yuantian/Documents/Coding/pi-vs-cc/extensions/minimal.ts
/Users/yuantian/Documents/Coding/pi-vs-cc/extensions/theme-cycler.ts
/Users/yuantian/Documents/Coding/pi-vs-cc/extensions/damage-control-continue.ts
/Users/yuantian/Documents/Coding/pi-vs-cc/.pi/agents/omp-topology-network/shared-protocol.md
/Users/yuantian/Documents/Coding/pi-vs-cc/.pi/agents/omp-topology-network/<role>.md
```

macOS note: Ghostty only receives `-e <command>` reliably when launched as a new app instance, so `--launch` uses `open -n -a Ghostty --args -e <role-script>`. Default mode prints only, so you can inspect commands before launching.
