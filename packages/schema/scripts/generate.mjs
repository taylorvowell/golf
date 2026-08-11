import { mkdirSync, writeFileSync } from "node:fs";
import { OUT_DIR, compileOne, outPathFor, schemaFiles } from "./schema-codegen.mjs";

mkdirSync(OUT_DIR, { recursive: true });

for (const file of schemaFiles()) {
  const out = outPathFor(file);
  writeFileSync(out, await compileOne(file));
  console.log(`wrote ${out}`);
}
