export interface NetComsStatus {
  implemented: false;
  status: "compatibility_target";
  note: string;
}

export function netComsStatus(): NetComsStatus {
  return {
    implemented: false,
    status: "compatibility_target",
    note: "HTTP/SSE topology transport is intentionally documented as a future compatibility target until it is smoke tested.",
  };
}
