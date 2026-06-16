import {
  TOPOLOGY_ROLES as CORE_TOPOLOGY_ROLES,
  type RolePolicy,
  type WorkerRole as CoreWorkerRole,
} from "../runtime/mission.ts";

export type TopologyRole = (typeof CORE_TOPOLOGY_ROLES)[number];
export type WorkerRole = Exclude<TopologyRole, "topology-supervisor">;

export const TOPOLOGY_ROLES: TopologyRole[] = [...CORE_TOPOLOGY_ROLES];

export const ROLE_POLICIES: Record<TopologyRole, RolePolicy> = {
  "topology-supervisor": {
    spawn_policy: "entry",
    write_policy: "no_business_code_writes",
    report_target: "owner",
  },
  hq: {
    spawn_policy: "required_after_mission_approval",
    write_policy: "no_business_code_writes",
    report_target: "topology-supervisor",
  },
  repair: {
    spawn_policy: "on_demand",
    write_policy: "allowed_paths_only",
    report_target: "hq",
  },
  runner: {
    spawn_policy: "on_demand",
    write_policy: "read_only",
    report_target: "hq",
  },
  oracle: {
    spawn_policy: "on_demand",
    write_policy: "read_only",
    report_target: "hq",
  },
  librarian: {
    spawn_policy: "on_demand",
    write_policy: "read_only",
    report_target: "hq",
  },
  scott: {
    spawn_policy: "on_demand",
    write_policy: "read_only",
    report_target: "hq",
  },
};

export const WORKER_ROLES: WorkerRole[] = TOPOLOGY_ROLES.filter((role): role is WorkerRole => role !== "topology-supervisor");
export const CORE_WORKER_ROLES: CoreWorkerRole[] = CORE_TOPOLOGY_ROLES.filter((role) => role !== "topology-supervisor");
