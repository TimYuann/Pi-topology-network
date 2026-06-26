# Pi Harness 安装记录

Date: 2026-06-15
Harness: `/Users/yuantian/Documents/Coding/pi-vs-cc`
Upstream: `https://github.com/disler/pi-vs-claude-code`
Verified upstream HEAD: `b93c3f14ef4786b6b9e442411b824671e421c56f`

## 最新性确认

`git ls-remote https://github.com/disler/pi-vs-claude-code.git HEAD` 返回：

```text
b93c3f14ef4786b6b9e442411b824671e421c56f HEAD
```

该提交信息为：

```text
--cname for coms-net and damage control
```

本地 Pi harness 已同步该提交涉及的相关文件，并保留本机 Pi runtime 适配。

## 独立项目边界

Pi harness 作为独立 Coding 项目维护：

```text
/Users/yuantian/Documents/Coding/pi-vs-cc
```

它不再放在 `ekunAi` 下，也不再由 Pi拓扑网络项目镜像源码。`ekunAi` 和 `Pi-topology-network` 只保留引用、协议和启动说明。

## 已同步文件

```text
extensions/coms.ts
extensions/coms-net.ts
extensions/damage-control.ts
extensions/damage-control-continue.ts
justfile
```

本机适配说明：

- `@mariozechner/pi-coding-agent` -> `@earendil-works/pi-coding-agent`
- `@mariozechner/pi-tui` -> `@earendil-works/pi-tui`
- `@sinclair/typebox` -> `typebox`

## 已安装 Pi拓扑网络角色包

```text
/Users/yuantian/Documents/Coding/pi-vs-cc/.pi/agents/pi-topology-network/
├── shared-protocol.md
├── governor.md
├── hq.md
├── oracle.md
├── repair.md
└── runner.md
```

## 已安装启动入口

脚本：

```text
/Users/yuantian/Documents/Coding/pi-vs-cc/scripts/print-pi-topology-launch.sh
```

`justfile` recipes：

```text
just topology-print <project>
just topology-governor <project>
just topology-hq <project>
just topology-oracle <project>
just topology-repair <project>
just topology-runner <project>
```

## 使用方式

打印五角色启动命令：

```bash
cd /Users/yuantian/Documents/Coding/pi-vs-cc
./scripts/print-pi-topology-launch.sh ekunAi-topology
```

单独启动 HQ：

```bash
cd /Users/yuantian/Documents/Coding/pi-vs-cc
PI_COMS_DIR=/tmp/pi-topology-ekunAi-topology \
pi -e extensions/coms.ts -e extensions/minimal.ts -e extensions/theme-cycler.ts \
  --cname hq --project ekunAi-topology \
  --append-system-prompt .pi/agents/pi-topology-network/shared-protocol.md \
  --append-system-prompt .pi/agents/pi-topology-network/hq.md
```

所有角色共享：

```bash
PI_COMS_DIR=/tmp/pi-topology-ekunAi-topology
```

## 项目引用

Pi拓扑网络中的 Pi harness 引用入口：

```text
/Users/yuantian/Documents/Coding/Pi-topology-network/sources/pi-harness/README.md
```

## Direct ACK 纪律

Pi 侧沿用 Pi拓扑网络同一套协议：收到入站任务先 direct final text ACK，不用 `coms_send` 回 ACK。`coms_await` timeout 只代表当前等待窗口未收到原消息回复，不代表 peer 没做。
