import type { CaptureView } from "./sessionState";

/**
 * Dual Sync's shared facts. Stubbed until pairing is real — the server mints the code with the
 * session, and the handshake detail becomes what the transport actually reports.
 */

/** The pairing code shown on the sheet and echoed while the handshake runs. */
export const DUAL_SYNC_CODE = "7K4P2Q";

export function viewLabel(view: CaptureView): string {
  return view === "dtl" ? "Down the line" : "Front view";
}
