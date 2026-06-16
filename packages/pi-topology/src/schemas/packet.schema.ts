export const packetSchema = {
  type: "object",
  required: ["packet_id", "mission_id", "type", "from", "to", "body", "hops", "max_hops"],
  properties: {
    packet_id: { type: "string" },
    mission_id: { type: "string" },
    type: { enum: ["ACK", "STATUS", "REPORT", "REQUEST", "INCIDENT", "VERDICT"] },
    from: { type: "string" },
    to: { type: "string" },
    body: { type: "object" },
    hops: { type: "number" },
    max_hops: { type: "number" },
  },
} as const;
