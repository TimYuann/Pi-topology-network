import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerPiTopology } from "./src/extension/register.ts";

export { registerPiTopology };

export default function piTopology(pi: ExtensionAPI): void {
  registerPiTopology(pi);
}
