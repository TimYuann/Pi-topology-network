import assert from "node:assert/strict";
import test from "node:test";
import {
  assertDirectReplyAllowed,
  createPacket,
  validatePacket,
} from "../../src/runtime/packet.ts";

test("allows original msg_id direct replies only for ACK-style lifecycle text", () => {
  assert.equal(assertDirectReplyAllowed("ACK").ok, true);
  assert.equal(assertDirectReplyAllowed("NEEDS_CLARIFICATION: missing allowed_paths").ok, true);

  const report = assertDirectReplyAllowed("I completed the implementation and here is a long business report.");
  assert.equal(report.ok, false);
  assert.equal(report.reason, "business_report_must_use_packet");
});

test("validates structured topology packets and hop policy", () => {
  const packet = createPacket({
    mission_id: "mission-1",
    type: "REPORT",
    from: "runner",
    to: "hq",
    body: { status: "pass" },
    correlation_id: "msg_1",
  });

  assert.equal(validatePacket(packet).ok, true);
  assert.equal(validatePacket({ ...packet, hops: 99 }).errors[0], "hops exceeds max_hops");
  assert.equal(validatePacket({ ...packet, body: "plain text" }).errors[0], "body must be an object");
  assert.equal(validatePacket({ ...packet, body: {} }).errors[0], "body must not be empty");
});

test("validates packets for librarian and scott research roles", () => {
  const packet = createPacket({
    mission_id: "mission-1",
    type: "REQUEST",
    from: "hq",
    to: "scott",
    body: { topic: "Pi package API" },
  });
  const report = createPacket({
    mission_id: "mission-1",
    type: "REPORT",
    from: "librarian",
    to: "hq",
    body: { index: "evidence-index.json" },
    request_msg_id: packet.packet_id,
  });

  assert.equal(validatePacket(packet).ok, true);
  assert.equal(validatePacket(report).ok, true);
});
