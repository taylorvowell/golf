import postgres from "postgres";

/**
 * Give `swingsage_app` a password, so the application has something to connect as.
 *
 * Migration 0008 creates the role NOLOGIN and without a password, because a password in a
 * committed migration is a credential in git. This is the other half, and it is deliberately a
 * separate, re-runnable step: `db:migrate` chains it, so a local database is ready the moment
 * migrations finish, and a deployed environment runs it with a real secret from the secret
 * manager (D10, still unimplemented — that is step 10's work).
 *
 * It refuses to invent a default for anything but a loopback host. A convenience password that
 * quietly works against a hosted project is how a known credential ends up in production.
 */
const LOCAL_DEV_PASSWORD = "swingsage_app";

function isLoopback(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "[::1]";
  } catch {
    return false;
  }
}

/** Single-quote a SQL string literal, doubling any quote inside it. */
function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set — this connects as the schema owner to grant login.");
  }

  const password =
    process.env.APP_DATABASE_PASSWORD?.trim() ||
    (isLoopback(databaseUrl) ? LOCAL_DEV_PASSWORD : "");
  if (!password) {
    throw new Error(
      "DATABASE_URL points at a non-local host and APP_DATABASE_PASSWORD is not set. Refusing " +
        "to set a well-known password on a remote database — supply the real one.",
    );
  }

  const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  try {
    const [role] = await sql<{ present: boolean }[]>`
      select exists (select 1 from pg_roles where rolname = 'swingsage_app') as present
    `;
    if (!role.present) {
      throw new Error("role swingsage_app does not exist — run `drizzle-kit migrate` first.");
    }

    // `alter role` takes no bind parameters, so the password is quoted as a SQL string literal
    // rather than passed. The role name is a constant; only the password is variable.
    await sql.unsafe(`alter role swingsage_app with login password ${quoteLiteral(password)}`);

    const [check] = await sql<{ superuser: boolean; bypassrls: boolean; can_login: boolean }[]>`
      select rolsuper as superuser, rolbypassrls as bypassrls, rolcanlogin as can_login
        from pg_roles where rolname = 'swingsage_app'
    `;
    if (check.superuser || check.bypassrls) {
      throw new Error(
        "swingsage_app has SUPERUSER or BYPASSRLS. It would ignore every policy — refusing to " +
          "report success (docs/DECISIONS.md D26).",
      );
    }

    const where = isLoopback(databaseUrl) ? "local" : new URL(databaseUrl).hostname;
    console.log(
      `swingsage_app on ${where}: login=${check.can_login}, superuser=false, bypassrls=false`,
    );
  } finally {
    await sql.end();
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
