import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createPacket } from "../../src/runtime/packet.ts";
import { validatePacket } from "../../src/runtime/packet.ts";
import {
  topology_await,
  topology_get,
  topology_list,
  topology_send,
} from "../../src/transport/local-coms.ts";
import { startLiveTopologyEndpoint } from "../../src/transport/live-coms.ts";

test("topology_send writes structured packets to sender outbox and recipient inbox", async () => {
  const root = await mkdtemp(join("/private/tmp", "pi-topology-"));
  const outboxPath = join(root, "projects", "dogfood", "packets", "outbox.jsonl");

  const packet = createPacket({
    mission_id: "mission-2026-06-16",
    type: "STATUS",
    from: "hq",
    to: "runner",
    body: { kind: "kickoff", objective: "run smoke" },
  });
  const result = await topology_send(root, "dogfood", packet);

  assert.equal(result.packet.packet_id, packet.packet_id);
  assert.equal(result.packet.to, "runner");
  assert.equal(result.packet.type, "STATUS");

  const outboxLines = (await readFile(outboxPath, "utf8")).trim().split("\n");
  assert.equal(outboxLines.length, 1);

  const listForRunner = await topology_list(root, "dogfood", "runner");
  assert.equal(listForRunner.length, 1);
  assert.equal(listForRunner[0].packet_id, packet.packet_id);
});

test("topology_send delivers to a live role endpoint after durable queue write", async () => {
  const root = await mkdtemp(join("/private/tmp", "pi-topology-"));
  const received: unknown[] = [];
  const endpoint = await startLiveTopologyEndpoint({
    root,
    project: "dogfood",
    role: "hq",
    sessionId: "hq-test-session",
    mode: "memory",
    onPacket(packet) {
      received.push(packet);
    },
  });

  try {
    const packet = createPacket({
      mission_id: "mission-2026-06-16",
      type: "REPORT",
      from: "runner",
      to: "hq",
      body: { status: "pass" },
    });
    const result = await topology_send(root, "dogfood", packet);

    assert.equal(result.live_delivery?.status, "delivered");
    assert.equal(received.length, 1);
    assert.deepEqual(received[0], packet);

    const hqInbox = await topology_list(root, "dogfood", "hq");
    assert.equal(hqInbox.length, 1);
    assert.equal(hqInbox[0].packet_id, packet.packet_id);
  } finally {
    await endpoint.close();
  }
});

test("supports HQ -> runner status then runner -> HQ report, with non-blocking get/list", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-topology-"));

  const status = createPacket({
    mission_id: "mission-2026-06-16",
    type: "STATUS",
    from: "hq",
    to: "runner",
    body: { kind: "instruction", step: "verify" },
  });
  const report = createPacket({
    mission_id: "mission-2026-06-16",
    type: "REPORT",
    from: "runner",
    to: "hq",
    body: { kind: "result", status: "pass" },
    request_msg_id: status.packet_id,
  });

  assert.equal(status.audit.transport_evidence.length, 0);
  assert.equal(status.audit.business_evidence.length, 0);
  assert.equal(status.audit.inference.length, 0);

  await topology_send(root, "dogfood", status);
  const runInboxAfterStatus = await topology_list(root, "dogfood", "runner");
  assert.equal(runInboxAfterStatus.length, 1);
  const runStatusGet = await topology_get(root, "dogfood", "runner", status.packet_id);
  assert.equal(runStatusGet.status, "complete");
  assert.equal(runStatusGet.packet.from, "hq");
  assert.equal(runStatusGet.packet.type, "STATUS");

  const pendingLookup = await topology_get(root, "dogfood", "hq", "packet-does-not-exist");
  assert.equal(pendingLookup.status, "pending");

  await topology_send(root, "dogfood", report);
  const hqInboxAfterReport = await topology_list(root, "dogfood", "hq");
  assert.equal(hqInboxAfterReport.length, 1);
  assert.equal(hqInboxAfterReport[0].type, "REPORT");
  const hqReportGet = await topology_get(root, "dogfood", "hq", report.packet_id);
  assert.equal(hqReportGet.status, "complete");
  assert.equal(hqReportGet.packet.request_msg_id, status.packet_id);
});

test("topology_await waits for a late matching report packet", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-topology-"));
  const request = createPacket({
    mission_id: "mission-2026-06-16",
    type: "REQUEST",
    from: "hq",
    to: "runner",
    body: { task: "verify" },
  });
  const report = createPacket({
    mission_id: "mission-2026-06-16",
    type: "REPORT",
    from: "runner",
    to: "hq",
    body: { status: "pass" },
    request_msg_id: request.packet_id,
  });

  const waiting = topology_await(root, "dogfood", "hq", {
    from: "runner",
    type: "REPORT",
    request_msg_id: request.packet_id,
  }, {
    timeoutMs: 1_000,
    pollIntervalMs: 20,
  });
  setTimeout(() => {
    void topology_send(root, "dogfood", report);
  }, 50);

  const result = await waiting;
  assert.equal(result.status, "complete");
  assert.equal(result.packets.length, 1);
  assert.equal(result.packets[0].packet_id, report.packet_id);
});

test("topology_await times out when no matching packet arrives", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-topology-"));

  const result = await topology_await(root, "dogfood", "hq", {
    from: "runner",
    type: "REPORT",
  }, {
    timeoutMs: 30,
    pollIntervalMs: 10,
  });

  assert.equal(result.status, "timeout");
  assert.equal(result.packets.length, 0);
});

test("topology_send blocks packets that violate hop policy", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-topology-"));
  const blocked = createPacket({
    mission_id: "mission-2026-06-16",
    type: "REPORT",
    from: "runner",
    to: "hq",
    body: { reason: "overflow" },
    max_hops: 1,
  });
  const validation = validatePacket(blocked);
  assert.equal(validation.ok, true);
  const overLimit = { ...blocked, hops: blocked.max_hops };
  await assert.rejects(async () => topology_send(root, "dogfood", overLimit));
});

test("topology_send blocks empty packet bodies", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-topology-"));
  const empty = createPacket({
    mission_id: "mission-2026-06-16",
    type: "REPORT",
    from: "scott",
    to: "hq",
    body: { reason: "placeholder" },
  });

  await assert.rejects(async () => topology_send(root, "dogfood", { ...empty, body: {} }));
});

test("topology_list supports research role inboxes", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-topology-"));
  const request = createPacket({
    mission_id: "mission-2026-06-16",
    type: "REQUEST",
    from: "hq",
    to: "scott",
    body: { research: "Pi package extension surface" },
  });

  await topology_send(root, "dogfood", request);

  const scottInbox = await topology_list(root, "dogfood", "scott");
  assert.equal(scottInbox.length, 1);
  assert.equal(scottInbox[0].packet_id, request.packet_id);
});
