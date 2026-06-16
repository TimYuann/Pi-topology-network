import path from "node:path";
import type { TopologyRole } from "./role-policy.ts";

export function bundledPromptPath(packageRoot: string, role: TopologyRole | "shared-protocol"): string {
  return path.join(packageRoot, "agents", role === "shared-protocol" ? "shared-protocol.md" : `${role}.md`);
}
