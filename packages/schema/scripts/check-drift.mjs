/**
 * Fails if src/generated/ no longer matches what the schema produces.
 *
 * A generated artifact that can silently go stale is not a contract: someone edits the .ts
 * because it is closer to hand, the schema stops describing reality, and the Python producer
 * and the two TypeScript clients quietly disagree. Wired into CI.
 */
import { readFileSync } from "node:fs";
import { compile, OUT } from "./schema-codegen.mjs";

const norm = (s) => s.replace(/\r\n/g, "\n").trim();

if (norm(readFileSync(OUT, "utf8")) !== norm(await compile())) {
  console.error(
    `\n${OUT} is stale.\n` +
      `Schema and generated types have drifted. Run:\n` +
      `  pnpm --filter @swingsage/schema generate\n` +
      `and commit the result. Never hand-edit the generated file.\n`,
  );
  process.exit(1);
}
console.log("schema/types in sync");
