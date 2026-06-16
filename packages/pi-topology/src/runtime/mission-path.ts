import path from "node:path";
import { isPathInsideAllowed } from "../utils/safe-paths.ts";

export function missionPathForWorkspace(cwd: string): string {
  const fallback = path.join(cwd, ".pi", "topology", "mission-card.json");
  const envMissionPath = process.env.PI_TOPOLOGY_MISSION_CARD;
  if (!envMissionPath) return fallback;

  const resolvedCwd = path.resolve(cwd);
  const envWorkdir = process.env.PI_TOPOLOGY_WORKDIR;
  if (envWorkdir && path.resolve(envWorkdir) !== resolvedCwd) return fallback;
  if (!isPathInsideAllowed(envMissionPath, [resolvedCwd])) return fallback;

  return envMissionPath;
}
