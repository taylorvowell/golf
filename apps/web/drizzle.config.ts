import { defineConfig } from "drizzle-kit";

// Loaded via `node --env-file=.env` in package.json's db:* scripts (Node 22 supports
// --env-file natively — no dotenv dependency needed just for this).
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
