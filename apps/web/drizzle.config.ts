import { defineConfig } from "drizzle-kit";

import { existsSync } from "node:fs";

// .env is loaded here rather than through `node --env-file` in the db:* scripts, because those
// scripts used to invoke drizzle-kit by a hardcoded `node_modules/drizzle-kit/bin.cjs` path.
// That path stopped existing when the repo moved to `node-linker=hoisted` (see .npmrc) and every
// dependency hoisted to the root. Loading the env here lets the scripts be plain `drizzle-kit
// migrate`, resolved through pnpm, which works under either linker.
//
// Still no dotenv dependency: Node 22 has this built in.
if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set — see .env.example");
}

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL },
  strict: true,
  verbose: true,
});
