export const missionSchema = {
  type: "object",
  required: ["mission_id", "runtime", "entry_role", "project", "workdir", "objective", "allowed_paths"],
  properties: {
    mission_id: { type: "string" },
    runtime: { const: "pi" },
    entry_role: { const: "topology-supervisor" },
    project: { type: "string" },
    workdir: { type: "string" },
    objective: { type: "string" },
    allowed_paths: { type: "array", items: { type: "string" }, minItems: 1 },
  },
} as const;
