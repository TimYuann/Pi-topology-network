# OMP 五角色启动模板

```bash
cd /Users/yuantian/Documents/Coding/<project>
export OMP_COMS_DIR=/tmp/pi-topology-<project>
export OMP_COMS_EXT=/Users/yuantian/.omp/agent/experiments/coms-omp

omp -e "$OMP_COMS_EXT" --cname governor --purpose "Owner-facing governor. Must direct-ACK inbound messages and dispatch only to hq." --project <project>-topology
omp -e "$OMP_COMS_EXT" --cname hq       --purpose "Development HQ. Must direct-ACK governor directives before planning or dispatching." --project <project>-topology
omp -e "$OMP_COMS_EXT" --cname oracle   --purpose "Independent reviewer. Reviews evidence and risk; does not edit code." --project <project>-topology
omp -e "$OMP_COMS_EXT" --cname repair   --purpose "Scoped repair executor. Edits only within hq-authorized scope." --project <project>-topology
omp -e "$OMP_COMS_EXT" --cname runner   --purpose "Verification runner. Runs tests and records artifacts; does not edit code." --project <project>-topology
```

启动后，把 `docs/01-shared-communication-policy.md` 和对应 `docs/roles/<role>.md` 注入每个角色上下文。

