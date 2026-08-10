/**
 * Single source for both generating and verifying src/generated/.
 *
 * Both entry points call compile() here with identical options and compare raw output. An
 * earlier version stripped leading comments before comparing, which was asymmetric: it removed
 * the banner from the committed file and the first JSDoc block from the freshly-compiled one,
 * so the check failed on a file nobody had touched. A drift check that cries wolf is worse than
 * none, because people learn to skip it.
 */
import { compileFromFile } from "json-schema-to-typescript";

export const SCHEMA = "schemas/analysis.schema.json";
export const OUT = "src/generated/analysis.ts";

export const BANNER =
  "/* GENERATED from schemas/analysis.schema.json - do not edit.\n" +
  " * Run: pnpm --filter @swingsage/schema generate */";

export const compile = () => compileFromFile(SCHEMA, { bannerComment: BANNER });
