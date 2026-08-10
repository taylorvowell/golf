import { writeFileSync } from "node:fs";
import { compile, OUT } from "./schema-codegen.mjs";

writeFileSync(OUT, await compile());
console.log(`wrote ${OUT}`);
