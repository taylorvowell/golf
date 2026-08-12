/**
 * Marks a module as reachable only from the command line, and enforces it at runtime.
 *
 * Some verification work legitimately needs a credential that must never sit on a request path —
 * the Supabase auth admin API, which can read and rewrite any identity in the project. `db/admin.ts`
 * solves the same problem for the schema-owner connection by throwing at import inside Next, and
 * `service-role.test.ts` uses that import as *proof* a module cannot be reached by a request.
 *
 * This is that proof extracted, so a script needing the guarantee does not have to import a
 * database connection it has no use for purely to inherit the guard. Importing this module is a
 * declaration with teeth: `NEXT_RUNTIME` is set in every server runtime Next.js owns, and never in
 * a plain `node --import tsx` process.
 */
if (process.env.NEXT_RUNTIME) {
  throw new Error(
    "A CLI-only module was imported inside Next.js. Modules marked with db/cliOnly hold " +
      "credentials that must never be reachable from request handling — see " +
      "docs/decisions/ARCHIVE-numbered.md D26 and D45.",
  );
}

/** Imported for the side effect above; the export exists so the import cannot be tree-shaken. */
export const CLI_ONLY = true;
