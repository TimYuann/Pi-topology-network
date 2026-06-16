export const statusSchema = {
  type: "object",
  required: ["mission_id", "runtime", "runtime_phase", "peer_status", "pending_packets"],
  properties: {
    mission_id: { type: "string" },
    runtime: { const: "pi" },
    runtime_phase: { type: "string" },
    peer_status: { type: "object" },
    pending_packets: { type: "array" },
  },
} as const;
