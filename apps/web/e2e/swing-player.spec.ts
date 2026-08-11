import { expect, test } from "@playwright/test";

/**
 * The one end-to-end path platform-foundation step 02 requires.
 *
 * It deliberately walks the chain that has the most links in it — browser → Next.js server →
 * Postgres → `analysis.json` and the video on disk — because every unit test in this repo stops
 * at the edge of that chain, and the gaps between those layers are where this project has
 * actually lost time. A stale `analysis.json`, a media root pointing somewhere else, or a swing
 * row without its artifacts all produce a page that renders and a player that never shows a
 * frame; none of them are visible to a unit test.
 *
 * What it does NOT claim to check: that the overlay is drawn on the correct frame. That is Gate 3
 * and needs pixel comparison against the analyzer's burn-in, which is `analysis-ground-truth`
 * work. This asserts the player reaches a state where such a check is possible at all.
 */

test.describe("swing log → player", () => {
  test("lists analysed swings and opens one into a working player", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "Swing Log" }).or(page.locator(".brand-mark")))
      .toBeVisible();

    // The log links to `/swing/<id>`. If there are none, the environment is not set up — say so
    // rather than passing vacuously, which is the failure mode this whole suite exists to avoid.
    const swingLinks = page.locator('a[href^="/swing/"]');
    const count = await swingLinks.count();
    expect(
      count,
      "no analysed swings in the database — run `pnpm db:backfill` (see docs/RUNBOOK.md)",
    ).toBeGreaterThan(0);

    const href = await swingLinks.first().getAttribute("href");
    expect(href).toBeTruthy();
    await swingLinks.first().click();

    await page.waitForURL(/\/swing\/.+/);

    // The player is a client component; the <video> is server-rendered so it starts loading with
    // the HTML, and the overlay canvas mounts with the client bundle.
    const video = page.locator("video").first();
    await expect(video).toBeAttached();
    await expect(page.locator("canvas").first()).toBeAttached({ timeout: 30_000 });

    const src = await video.getAttribute("src");
    expect(src, "video should stream from the swing's own media route").toMatch(
      /^\/api\/swings\/.+\/video/,
    );

    // The real assertion: the browser got far enough into the stream to know how long it is and
    // how big it is. `readyState >= 1` (HAVE_METADATA) is the first point at which the media
    // route is proven to have served decodable video rather than a 404 page or an empty body.
    await expect
      .poll(
        () => video.evaluate((el: HTMLVideoElement) => el.readyState),
        {
          message: "video never reached HAVE_METADATA — the media route served nothing decodable",
          timeout: 45_000,
        },
      )
      .toBeGreaterThanOrEqual(1);

    const dims = await video.evaluate((el: HTMLVideoElement) => ({
      w: el.videoWidth,
      h: el.videoHeight,
      duration: el.duration,
    }));
    expect(dims.w).toBeGreaterThan(0);
    expect(dims.h).toBeGreaterThan(0);
    expect(dims.duration).toBeGreaterThan(0);

    // Transport control is present and labelled — the accessibility hook the mobile port has to
    // reproduce, and the thing §41 will be verified against later.
    //
    // Matched on the transport button, whose label is state-INdependent. The picture itself is
    // also a play/pause target, but its label flips to "Pause swing" the moment playback starts,
    // so asserting on "Play swing" is a race against autoplay rather than a check of anything.
    await expect(page.getByRole("button", { name: "Play or pause swing" })).toBeVisible();
    await expect(page.getByRole("button", { name: /^(play|pause) swing$/i })).toBeVisible();
  });
});
