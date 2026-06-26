import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  getDurableFsTestHooks,
  setDurableFsTestHooks,
  writeJsonAtomicallyDurable,
} from "../../../src/runtime/foundation0/durable-fs.ts";

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "foundation0-durable-fs-"));
}

test("writeJsonAtomicallyDurable fsyncs temp file before rename and parent directory after rename", async () => {
  const dir = await tempDir();
  const previousHooks = getDurableFsTestHooks();
  const calls: string[] = [];
  try {
    setDurableFsTestHooks({
      onFsyncFile: (path) => calls.push(`file:${path.endsWith(".tmp") ? "tmp" : path}`),
      onRename: () => calls.push("rename"),
      onFsyncDirectory: (path) => calls.push(`dir:${path}`),
    });

    const path = join(dir, "projection.json");
    await writeJsonAtomicallyDurable(path, { b: 2, a: 1 });

    assert.deepEqual(JSON.parse(await readFile(path, "utf8")), { a: 1, b: 2 });
    assert.deepEqual(calls, ["file:tmp", "rename", `dir:${dir}`]);
  } finally {
    setDurableFsTestHooks(previousHooks);
    await rm(dir, { recursive: true, force: true });
  }
});
