import sharp from "sharp";

import { POSTER_NAME } from "@/lib/ingest";
import { ARTIFACT_BUCKET, SOURCE_BUCKET, artifactKey, sourceKey } from "@/lib/media/keys";
import { getMediaStore } from "@/lib/media/store";
import { requireViewAccess, viewParam } from "@/lib/auth";

/**
 * The contact-frame still the analyzer already writes next to `analysis.json`.
 *
 * The swing log was a text list because nothing served an image, not because none existed —
 * `burnin.py` has written `contact.jpg` all along (UI brief §8.7). A missing file is a plain
 * 404 rather than an error, so a log entry produced before this stage existed just falls back
 * to the card's placeholder.
 *
 * `?poster=1` serves ONE frame instead of the whole sheet — the mobile home screen draws swing
 * photography (hero, sliders) and a 24-frame grid at card size reads as noise. The sheet is a
 * fixed 6×4 grid (`render.contact_sheet(cols=6, rows=4)` — change one, change the other), so
 * the first cell is a deterministic crop: the earliest sampled frame, the golfer at setup, with
 * the analysis overlay burned in. Cropped here rather than on the phone because the grid's
 * geometry is the analyzer's business, and a client that hardcodes it breaks silently the day
 * the sheet changes shape.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const access = await requireViewAccess(id, viewParam(req));
  if ("error" in access) return access.error;

  const store = await getMediaStore();
  const bytes = await store.getBytes(
    ARTIFACT_BUCKET,
    artifactKey(access.address, "contact.jpg"),
  );
  if (!bytes) {
    /**
     * No analysis yet (or none ever) — fall back to the poster the CLIENT uploaded at save:
     * one frame of the golfer at address, extracted on the phone in the same beat as the trim.
     * It is already a single frame, so the `?poster=1` grid crop below never applies; the
     * analyzer's contact sheet takes over at this same URL the moment it exists.
     */
    const poster = await store.getBytes(SOURCE_BUCKET, sourceKey(access.address, POSTER_NAME));
    if (!poster) return new Response("not found", { status: 404 });
    return new Response(new Uint8Array(poster), {
      status: 200,
      headers: {
        "Content-Type": "image/jpeg",
        "Content-Length": String(poster.byteLength),
        // Short-lived, unlike the artifact's day: the analysed frame REPLACES this at the same
        // URL, and a day-long cache would keep showing the plain poster past that swap.
        "Cache-Control": "private, max-age=300",
      },
    });
  }

  let body: Uint8Array<ArrayBuffer> = new Uint8Array(bytes);
  if (new URL(req.url).searchParams.has("poster")) {
    try {
      const sheet = sharp(Buffer.from(bytes));
      const meta = await sheet.metadata();
      if (meta.width && meta.height) {
        const cropped = await sheet
          .extract({
            left: 0,
            top: 0,
            width: Math.floor(meta.width / 6),
            height: Math.floor(meta.height / 4),
          })
          .jpeg({ quality: 82 })
          .toBuffer();
        // The copying constructor, deliberately: it re-backs the Buffer with a plain ArrayBuffer,
        // which is what `Response` accepts.
        body = new Uint8Array(cropped);
      }
      // A sheet sharp cannot read falls through to the full image — a grid is a worse poster
      // than a crop, but a broken image is worse than either.
    } catch {
      body = new Uint8Array(bytes);
    }
  }

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "image/jpeg",
      "Content-Length": String(body.byteLength),
      // Addressed by revision, so a re-analysis mints a different URL rather than changing what
      // this one returns. The no-store that used to be needed here is therefore obsolete — but a
      // private cache only: this is a picture of a person mid-swing.
      "Cache-Control": "private, max-age=86400",
    },
  });
}
