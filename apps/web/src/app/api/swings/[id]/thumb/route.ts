import { readFile } from "node:fs/promises";
import { swingFile } from "@/lib/swings";
import { requireSwingAccess } from "@/lib/auth";

/**
 * The contact-frame still the analyzer already writes next to `analysis.json`.
 *
 * The swing log was a text list because nothing served an image, not because none existed —
 * `burnin.py` has written `contact.jpg` all along (UI brief §8.7). A missing file is a plain
 * 404 rather than an error, so a log entry produced before this stage existed just falls back
 * to the card's placeholder.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const access = await requireSwingAccess(id);
  if ("error" in access) return access.error;

  let file: string;
  try {
    file = swingFile(id, "contact.jpg");
  } catch {
    return new Response("bad id", { status: 400 });
  }

  try {
    const buf = await readFile(file);
    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": "image/jpeg",
        "Content-Length": String(buf.byteLength),
        // The analyzer rewrites this on every re-analysis, and a stale thumbnail beside a
        // fresh analysis is exactly the confusion the Re-analyze button exists to avoid.
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return new Response("not found", { status: 404 });
  }
}
