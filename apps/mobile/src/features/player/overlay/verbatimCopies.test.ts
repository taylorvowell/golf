import { readFileSync } from "fs";
import { join } from "path";

/**
 * The tripwire for the COPIED VERBATIM files.
 *
 * Four files in this folder are byte-for-byte copies of their `apps/web/src/lib/` originals,
 * duplicated deliberately (see docs/decisions/mobile-client.md, "analysis.json is duplicated
 * into the mobile tree, not shared") because sharing them means Metro resolution config and a
 * native rebuild to move pure array math. The register names the un-duplication trigger as "the
 * first time the two copies are found to have diverged" — and before this test, nothing was
 * positioned to find that. A hotfix applied to one copy alone silently draws two different
 * lines over the same swing, which is exactly the failure `checkoverlay.ts` was built after.
 *
 * The mobile copy carries one extra leading banner comment saying it is a copy; everything
 * after that banner must equal the web original exactly.
 */

const WEB_LIB = join(__dirname, "..", "..", "..", "..", "..", "web", "src", "lib");

const PAIRS = ["traceSmoothing.ts", "playbackWindow.ts", "skeleton.ts", "clubVariants.ts", "model.ts"];

/** Drop the first block comment (the mobile banner) and normalize line endings. */
function normalizedMobile(name: string): string {
  return readFileSync(join(__dirname, name), "utf8")
    .replace(/\r\n/g, "\n")
    .replace(/^\/\*\*[\s\S]*?\*\/\n/, "");
}

function normalizedWeb(name: string): string {
  return readFileSync(join(WEB_LIB, name), "utf8").replace(/\r\n/g, "\n");
}

describe("COPIED VERBATIM twins", () => {
  it.each(PAIRS)("%s matches its apps/web/src/lib original byte-for-byte", (name) => {
    const mobile = normalizedMobile(name);
    const web = normalizedWeb(name);
    if (mobile !== web) {
      throw new Error(
        `${name} has diverged from apps/web/src/lib/${name}. Edit BOTH copies, or ` +
          `un-duplicate into a shared package — the register names divergence as the trigger ` +
          `(docs/decisions/mobile-client.md, "analysis.json is duplicated into the mobile tree").`,
      );
    }
  });
});
