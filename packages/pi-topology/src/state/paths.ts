import os from "node:os";
import path from "node:path";

export function defaultTopologyStateDir(cwd: string): string {
  return path.join(cwd, ".pi", "topology");
}

export function defaultTransportRoot(project: string): string {
  return path.join(os.tmpdir(), `pi-topology-${project}`);
}

export function resolveStateFile(cwd: string, relativeOrAbsolute: string): string {
  return path.isAbsolute(relativeOrAbsolute) ? relativeOrAbsolute : path.join(cwd, relativeOrAbsolute);
}
