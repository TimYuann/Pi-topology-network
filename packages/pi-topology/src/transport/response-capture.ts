import { assertDirectReplyAllowed } from "../runtime/packet.ts";

export function classifyCapturedFinalText(text: string): {
  channel: "direct_reply" | "packet_required";
  reason?: string;
} {
  const allowed = assertDirectReplyAllowed(text);
  return allowed.ok ? { channel: "direct_reply" } : { channel: "packet_required", reason: allowed.reason };
}
