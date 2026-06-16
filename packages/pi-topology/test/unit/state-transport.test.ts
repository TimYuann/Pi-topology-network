import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { appendEvent } from "../../src/state/event-log.ts";
import { appendIncident } from "../../src/state/incident-log.ts";
import {
  appendOutboundPacket,
  readOutboundPackets,
} from "../../src/transport/local-coms.ts";
import {
  peerRegistryPath,
  readPeerRegistry,
  writePeerRegistry,
} from "../../src/transport/registry.ts";

test("writes registry entries and packet outbox as replayable JSON", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-topology-"));

  const registryPath = peerRegistryPath(root, "dogfood", "hq");
  assert.equal(registryPath.endsWith("/projects/dogfood/agents/hq.json"), true);

  await writePeerRegistry(root, "dogfood", {
    name: "hq",
    session_id: "s1",
    endpoint: "local://hq",
    role: "hq",
    heartbeat_at: "2026-06-16T00:00:00.000Z",
    context_used_pct: 12,
  });
  assert.equal((await readPeerRegistry(root, "dogfood")).hq.session_id, "s1");

  await appendOutboundPacket(root, "dogfood", { packet_id: "pkt_1", type: "STATUS" });
  assert.equal((await readOutboundPackets(root, "dogfood")).length, 1);

  const eventPath = join(root, "events.jsonl");
  await appendEvent(eventPath, { event_type: "packet_sent", mission_id: "m1" });
  assert.match(await readFile(eventPath, "utf8"), /packet_sent/);

  const incidentPath = join(root, "incidents.jsonl");
  await appendIncident(incidentPath, { incident_type: "owner_gate", summary: "git push blocked" });
  assert.match(await readFile(incidentPath, "utf8"), /owner_gate/);
});
