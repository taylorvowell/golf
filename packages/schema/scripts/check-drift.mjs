/**
 * Fails if `src/generated/` no longer matches what the schemas produce.
 *
 * A generated artifact that can silently go stale is not a contract: someone edits the .ts
 * because it is closer to hand, the schema stops describing reality, and the Python producer
 * and the two TypeScript clients quietly disagree. Wired into CI.
 */
import { existsSync, readFileSync } from "node:fs";
import { compileOne, outPathFor, schemaFiles } from "./schema-codegen.mjs";

const norm = (s) => s.replace(/\r\n/g, "\n").trim();
const stale = [];

for (const file of schemaFiles()) {
  const out = outPathFor(file);
  if (!existsSync(out)) {
    stale.push(`${out} (missing)`);
    continue;
  }
  if (norm(readFileSync(out, "utf8")) !== norm(await compileOne(file))) stale.push(out);
}

if (stale.length) {
  console.error(
    `\n${stale.join("\n")}\n` +
      `\nSchema and generated types have drifted. Run:\n` +
      `  pnpm --filter @swingsage/schema generate\n` +
      `and commit the result. Never hand-edit a generated file.\n`,
  );
  process.exit(1);
}
console.log(`schema/types in sync (${schemaFiles().length} contracts)`);
