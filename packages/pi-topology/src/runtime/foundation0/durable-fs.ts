import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, rename, stat, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";

import { canonicalizeForDigest } from "./ids.ts";

export interface DurableFsTestHooks {
  onFsyncFile?: (path: string) => void;
  onFsyncDirectory?: (path: string) => void;
  onRename?: (from: string, to: string) => void;
}

let durableFsTestHooks: DurableFsTestHooks = {};

export function getDurableFsTestHooks(): DurableFsTestHooks {
  return durableFsTestHooks;
}

export function setDurableFsTestHooks(hooks: DurableFsTestHooks): void {
  durableFsTestHooks = hooks;
}

export async function fsyncFile(path: string): Promise<void> {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY);
    await handle.sync();
    durableFsTestHooks.onFsyncFile?.(path);
  } finally {
    await handle?.close();
  }
}

export async function fsyncDirectory(path: string): Promise<void> {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY);
    await handle.sync();
    durableFsTestHooks.onFsyncDirectory?.(path);
  } finally {
    await handle?.close();
  }
}

export async function writeDurableFile(
  path: string,
  content: string,
  flags: string | number,
): Promise<void> {
  let handle;
  try {
    handle = await open(path, flags, 0o600);
    await handle.writeFile(content, "utf8");
    await handle.sync();
    durableFsTestHooks.onFsyncFile?.(path);
  } finally {
    await handle?.close();
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export async function appendFileDurably(
  path: string,
  content: string,
): Promise<{ created: boolean }> {
  const parent = dirname(path);
  await mkdir(parent, { recursive: true });
  const existed = await pathExists(path);
  await writeDurableFile(
    path,
    content,
    constants.O_CREAT | constants.O_APPEND | constants.O_WRONLY,
  );
  if (!existed) await fsyncDirectory(parent);
  return { created: !existed };
}

export async function renameDurably(from: string, to: string): Promise<void> {
  await rename(from, to);
  durableFsTestHooks.onRename?.(from, to);
  await fsyncDirectory(dirname(to));
}

export async function unlinkIfExists(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
}

export async function writeJsonAtomicallyDurable(
  path: string,
  value: unknown,
): Promise<void> {
  const parent = dirname(path);
  await mkdir(parent, { recursive: true });
  const tempPath = join(parent, `.${randomUUID()}.tmp`);
  try {
    await writeDurableFile(
      tempPath,
      `${canonicalizeForDigest(value)}\n`,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
    );
    await renameDurably(tempPath, path);
  } catch (error) {
    await unlinkIfExists(tempPath);
    throw error;
  }
}
