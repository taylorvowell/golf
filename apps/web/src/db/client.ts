import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * One pooled connection per process. Next.js dev hot-reloads this module, so the client is
 * cached on `globalThis` the same way Prisma's own docs recommend — otherwise every hot-reload
 * opens a fresh pool against Postgres and old ones leak until the dev server restarts.
 */
declare global {
  var __swingsageDb: ReturnType<typeof postgres> | undefined;
}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is not set. Copy apps/web/.env.example to apps/web/.env and start Postgres " +
    "with `docker compose up -d` from the repo root."
  );
}

const client = globalThis.__swingsageDb ?? postgres(DATABASE_URL, { max: 10 });
if (process.env.NODE_ENV !== "production") globalThis.__swingsageDb = client;

export const db = drizzle(client, { schema });
