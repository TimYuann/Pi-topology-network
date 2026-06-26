import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  appendFoundation0Event,
  readFoundation0Events,
  verifyFoundation0EventPayloads,
} from "../../../src/runtime/foundation0/event-append.ts";

const MISSION_ID = "mission_foundation0_t2_concurrent";

test("concurrent append produces unique contiguous mission sequences", async () => {
  const missionDir = await mkdtemp(join(tmpdir(), "foundation0-concurrent-"));
  try {
    await Promise.all(
      Array.from({ length: 24 }, async (_, i) =>
        appendFoundation0Event({
          missionDir,
          missionId: MISSION_ID,
          eventType: "action_requested",
          entityType: "action",
          entityId: `action_${String(i).padStart(3, "0")}`,
          payload: { action_index: i },
          idempotencyKey: `action_${i}`,
          lockId: `concurrent_${i}`,
        }),
      ),
    );

    const events = await readFoundation0Events(missionDir);
    const sequences = events.map((event) => event.sequence).sort((a, b) => a - b);
    assert.deepEqual(
      sequences,
      Array.from({ length: 24 }, (_, i) => i),
    );
    assert.equal(new Set(events.map((event) => event.event_id)).size, 24);

    await verifyFoundation0EventPayloads(missionDir);
  } finally {
    await rm(missionDir, { recursive: true, force: true });
  }
});
