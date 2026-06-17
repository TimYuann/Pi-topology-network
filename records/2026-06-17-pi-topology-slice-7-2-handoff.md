# Slice 7.2 Handoff — Close the remaining pi-stub-* leak in createPiStubDir

日期：2026-06-17
项目：OMP拓扑网络 / `packages/pi-topology`
实施者：Pi Coder (MiniMax-M3, Pi Harness)
Commit：`56abd2f fix(slice-7.2): close the remaining pi-stub-* leak in createPiStubDir` (local, not pushed)
前置：`2bdf3c3 fix(slice-7.1)` + `records/2026-06-17-pi-topology-slice-7-1-handoff.md`
触发：Codex Reviewer 暂不放行 7.1，要求小修后再复审
状态：✅ 1 dogfood pass + 297/297 unit + smoke pass + 0 残留（Node tmpdir + /tmp）

## 1. 修复

| Finding | 优先级 | 修复 | 状态 |
| --- | --- | --- | --- |
| `createPiStubDir` 三元表达式调 `makeRunId()` 两次 → 第一个 stub 目录创建了但**没被记录**，cleanup 只能删第二个 | P2 | 路径算一次，`mkdirSync` 同名路径，return 该路径 | ✅ |

## 2. 根因

**`src/runtime/dogfood.ts` `createPiStubDir` 旧代码**：
```ts
const dir = mkdirSync(path.join(tmpdir(), `pi-stub-${makeRunId()}`), { recursive: true }) ?
  path.join(tmpdir(), `pi-stub-${makeRunId()}`) :  // ← 又调一次 makeRunId()
  path.join(tmpdir(), "pi-stub-fallback");
mkdirSync(dir, { recursive: true });
```

**问题**：
- condition side：`mkdirSync(<id-A>)` 创建 dir-A
- truthy branch：返回 `<id-B>`（新的 id，因为又调一次 `makeRunId()`）
- dir-A 创建了，但 `DogfoodRun.pi_stub_dir` 记录的是 dir-B
- cleanup 删 dir-B，dir-A **永远泄漏**

每次 dogfood 跑都会泄漏 **1 个** pi-stub-* 目录。reviewer 查到 43 个。

## 3. 修复

**新代码**：
```ts
function createPiStubDir(): string {
  const dir = path.join(tmpdir(), `pi-stub-${makeRunId()}`);
  mkdirSync(dir, { recursive: true });
  // ... stub 写入
  return dir;
}
```

- `makeRunId()` 只调一次
- `dir` 是 created path = returned path
- `DogfoodRun.pi_stub_dir` 准确指向创建的目录
- `cleanupDogfood` 删的就是这个目录

## 4. Reviewer 验证方式

Reviewer 用的检查命令：
```
find "$(node -e 'console.log(require("node:os").tmpdir())')" -maxdepth 1 -type d -name 'pi-stub-*'
```

注意：macOS Node `tmpdir()` 是 `/var/folders/.../T/`，**不是** `/tmp`。之前 slice 7.1 的检查 `ls -d /tmp/pi-stub-*` 漏了 Node tmpdir 实际位置。

## 5. 验证

**修复前**：
```
$ find "$(node -e 'console.log(require("node:os").tmpdir())')" -maxdepth 1 -type d -name 'pi-stub-*' | wc -l
43
```

**手动清理后 + 修复 + 重跑 dogfood**：
```
$ find "$(node -e 'console.log(require("node:os").tmpdir())')" -maxdepth 1 -type d -name 'pi-stub-*' | wc -l
0

$ find "$(node -e 'console.log(require("node:os").tmpdir())')" -maxdepth 1 -type d -name 'pi-topology-dogfood-*' | wc -l
0

$ ls -d /tmp/pi-stub-* | wc -l
0
```

**Evidence 字段**：
```
pi_stub_dir: /var/folders/vq/dk3gntzd7dz529mp_57ybgyh0000gn/T/pi-stub-20260617-150002-38kg
supervisor_exit_code: 0
post_cleanup_stub_proof: cleanup_ok_stub_removed:/var/folders/vq/dk3gntzd7dz529mp_57ybgyh0000gn/T/pi-stub-20260617-150002-38kg
```

## 6. Smoke 验证

```
$ cd packages/pi-topology && npm test
# tests 297
# pass 297
# fail 0

$ cd packages/pi-topology && npm run dogfood
# tests 1
# pass 1
# fail 0

$ cd packages/pi-topology && npm run smoke
> tarball: pi-topology-network-0.1.0.tgz
> package size: 112.5 kB (slice 7.1: 112.4 kB, +0.1 kB)
> total files: 62 (unchanged)
```

## 7. Evidence paths

- 修复 commit：`56abd2f fix(slice-7.2): close the remaining pi-stub-* leak in createPiStubDir`
- Handoff commit：紧随其后
- Handoff doc：`records/2026-06-17-pi-topology-slice-7-2-handoff.md`（本文件）
- Spec 对位：§13 slice 7 acceptance gate 收口 ✅ / E2E window governance 真正收紧 ✅
- API audit 对位：本 slice 不引入新 Pi primitive
- 闸纪律：所有 slice 1-7 gates 仍生效

## 8. 给 Reviewer 的 finding 复审

### [P2] pi-stub 残留
- ✅ `createPiStubDir` 路径算一次 + mkdirSync 同一路径
- ✅ `DogfoodRun.pi_stub_dir` 现在 = 创建路径 = 返回路径
- ✅ `cleanupDogfood` 删的就是这个目录
- ✅ 现有 43 个残留已清（`find ... -name 'pi-stub-*' -exec rm -rf`）
- ✅ 2 个 leftover dogfood-debug 目录已清
- ✅ Reviewer 验证命令 `find "$(node -e '...')" -name 'pi-stub-*'` 输出 0

### 已确认修好的部分（slice 7.1）
- ✅ Log 必须存在（非 "if exists"）
- ✅ Log 必须含 `[pi-stub] launched`
- ✅ Log 必须含 `--cname topology-supervisor`
- ✅ Supervisor exit code === 0
- ✅ pi-stub 残留 = 0

## 9. Roadmap 完成度（最终）

| Slice | 状态 |
|---|---|
| 1. Mission registry / per-Mission layout | ✅ |
| 2. Supervisor picker / resume / create | ✅ |
| 3. Session registry semantics | ✅ |
| 4. Inbox cleanup / stale packet marking | ✅ |
| 5. Dashboard / status output | ✅ |
| 6. Migration from legacy | ✅ |
| 7. Final dogfood with direct generated-script launches | ✅ |
| 7.1 pi-stub cleanup + tightened assertions | ✅ |
| 7.2 close remaining pi-stub-* leak | ✅ |

**Roadmap 全部完成**（7 main + 5 hotfix patches = 12 commits since slice 1）。

## 10. 实施者立场

P2 漏口全修。`createPiStubDir` 路径计算 deterministic，cleanup 完整。**0 残留**在 Node tmpdir 和 /tmp。

请 Reviewer 复审放行 OMP topology runtime spec 实施完成，进入 release readiness（spec §9）。