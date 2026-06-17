# Dogfood Run — smoke

started_at: 2026-06-17T15:35:41.562Z
finished_at: 2026-06-17T15:35:42.009Z
run_root: /var/folders/vq/dk3gntzd7dz529mp_57ybgyh0000gn/T/pi-topology-dogfood-smoke
mission_id: dogfood-smoke-2026-06-17-001
mission_title: Slice 7 smoke: verify slice 1-6 end-to-end

## 10-Field Evidence (per slice 7 memory rule)

1. launch_mode: direct-script-with-pi-stub
2. run_root: /var/folders/vq/dk3gntzd7dz529mp_57ybgyh0000gn/T/pi-topology-dogfood-smoke
3. generated_scripts:
   - topology-supervisor: /var/folders/vq/dk3gntzd7dz529mp_57ybgyh0000gn/T/pi-topology-dogfood-smoke/.pi/topology/launch/topology-supervisor.sh
   - hq: /var/folders/vq/dk3gntzd7dz529mp_57ybgyh0000gn/T/pi-topology-dogfood-smoke/.pi/topology/launch/hq.sh
   - repair: /var/folders/vq/dk3gntzd7dz529mp_57ybgyh0000gn/T/pi-topology-dogfood-smoke/.pi/topology/launch/repair.sh
   - runner: /var/folders/vq/dk3gntzd7dz529mp_57ybgyh0000gn/T/pi-topology-dogfood-smoke/.pi/topology/launch/runner.sh
   - oracle: /var/folders/vq/dk3gntzd7dz529mp_57ybgyh0000gn/T/pi-topology-dogfood-smoke/.pi/topology/launch/oracle.sh
   - librarian: /var/folders/vq/dk3gntzd7dz529mp_57ybgyh0000gn/T/pi-topology-dogfood-smoke/.pi/topology/launch/librarian.sh
   - scott: /var/folders/vq/dk3gntzd7dz529mp_57ybgyh0000gn/T/pi-topology-dogfood-smoke/.pi/topology/launch/scott.sh
4. pi_session_file_path: n/a (pi stub used; sessions.jsonl record_id=sess-hq-dogfood-1)
5. pids: 3906
6. sessions_path: /var/folders/vq/dk3gntzd7dz529mp_57ybgyh0000gn/T/pi-topology-dogfood-smoke/.pi/topology/missions/dogfood-smoke-2026-06-17-001/sessions.jsonl
7. runtime_events_path: /var/folders/vq/dk3gntzd7dz529mp_57ybgyh0000gn/T/pi-topology-dogfood-smoke/.pi/topology/missions/dogfood-smoke-2026-06-17-001/runtime-events.jsonl
8. terminal_log_path: /var/folders/vq/dk3gntzd7dz529mp_57ybgyh0000gn/T/pi-topology-dogfood-smoke/logs/topology-supervisor.log
9. cleanup_command: `pgrep -f '/var/folders/vq/dk3gntzd7dz529mp_57ybgyh0000gn/T/pi-topology-dogfood-smoke' | xargs -r kill -TERM 2>/dev/null; sleep 1; pgrep -f '/var/folders/vq/dk3gntzd7dz529mp_57ybgyh0000gn/T/pi-topology-dogfood-smoke' | xargs -r kill -KILL 2>/dev/null; rm -rf '/var/folders/vq/dk3gntzd7dz529mp_57ybgyh0000gn/T/pi-topology-dogfood-smoke'; pgrep -f '/var/folders/vq/dk3gntzd7dz529mp_57ybgyh0000gn/T/pi-topology-dogfood-smoke' || echo "cleanup_ok_no_residual_processes"`
10. post_cleanup_ps_proof: cleanup_ok_no_residual_processes

pi_stub_dir: /var/folders/vq/dk3gntzd7dz529mp_57ybgyh0000gn/T/pi-stub-20260617-153541-wdw8
supervisor_exit_code: 0
post_cleanup_stub_proof: cleanup_ok_stub_removed:/var/folders/vq/dk3gntzd7dz529mp_57ybgyh0000gn/T/pi-stub-20260617-153541-wdw8
## Dashboard (compact)
```
mission: dogfood-smoke-2026-06-17-001 (Slice 7 smoke: verify slice 1-6 end-to-end)
lifecycle: running
owner_gate: required
next_action: inspect
roles: live=1 resumable=1 stale=4 parked=0 closed=1
pending_packets: 3 (active_total=3, stale=1)
incidents: 0
closeout: none
```

## Dashboard Snapshot Fields (spec §10)
```
active_mission_id: dogfood-smoke-2026-06-17-001
lifecycle_state: running
owner_gate: required
next_action: inspect
role_summary: live=1 resumable=1 stale=4 parked=0 closed=1
pending_packet_count: 3
pending_packet_total: 3
stale_packet_count: 1
incident_count: 0
closeout_path: (none)
```

## Legacy Migration Step
```
legacy_workspace: /var/folders/vq/dk3gntzd7dz529mp_57ybgyh0000gn/T/pi-topology-dogfood-smoke/_legacy_sibling
mode: migrated
ok: true
mission_id: dogfood-smoke-2026-06-17-001-legacy
files_migrated: ["sessions.jsonl","runtime-events.jsonl","incident-log.jsonl"]
files_created_empty: []
reason: (none)
```
