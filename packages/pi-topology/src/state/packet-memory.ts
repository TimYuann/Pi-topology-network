const packetSeenBySession = new Map<string, Set<string>>();
const packetClosedBySession = new Map<string, Set<string>>();

function sessionKey(missionId: string, role: string): string {
  return `${missionId}::${role}`;
}

function ensureSet(store: Map<string, Set<string>>, key: string): Set<string> {
  let set = store.get(key);
  if (!set) {
    set = new Set<string>();
    store.set(key, set);
  }
  return set;
}

export function markPacketSeen(missionId: string, role: string, packetId: string): boolean {
  const seen = ensureSet(packetSeenBySession, sessionKey(missionId, role));
  const duplicate = seen.has(packetId);
  seen.add(packetId);
  return duplicate;
}

export function rememberClosedPacket(missionId: string, role: string, packetId: string): void {
  ensureSet(packetClosedBySession, sessionKey(missionId, role)).add(packetId);
}

export function hasClosedPacket(missionId: string, role: string, packetId: string): boolean {
  return packetClosedBySession.get(sessionKey(missionId, role))?.has(packetId) ?? false;
}

export function clearPacketMemory(missionId: string, role: string): void {
  const key = sessionKey(missionId, role);
  packetSeenBySession.delete(key);
  packetClosedBySession.delete(key);
}
