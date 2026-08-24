#!/usr/bin/env node
/**
 * Deploy apps/web to Vercel production — FROM THIS WINDOWS MACHINE.
 *
 *   node scripts/deploy-web.mjs
 *
 * Why this script exists: Vercel's own Linux builders split this app into >12 functions
 * (over the Hobby cap) while the CLI's local build bundles it into ~6 — so production deploys
 * are `vercel build` here + `vercel deploy --prebuilt`. But @vercel/next's Windows build
 * under-traces the output, and each gap was found the hard way on 2026-08-23:
 *
 *   1. symlink targets are written with backslashes (Linux cannot resolve them),
 *   2. the function filesets omit `.next/server/chunks` (every route 500s: ChunkLoadError),
 *   3. they omit most of next/dist's runtime and next's own dependency packages,
 *   4. they OVER-trace local machine state (services/, .media/, .env — 4k+ files that must
 *      never ship; the .env one put DEV_USER_EMAIL into a build until the D43 guard refused).
 *
 * This script runs the pristine build and applies those four fixes deterministically.
 * THE DURABLE REPLACEMENT is a Linux CI build (step 10's remaining CI work) — when deploys
 * run from GitHub Actions, none of this patching applies and this script retires.
 *
 * Build-time env comes from production-credentials.local.txt + the production constants
 * below. Secrets are read, never printed. DEV_USER_EMAIL is forced empty so the D43 guard
 * sees a production shape.
 */
import { execSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, readdirSync, statSync, lstatSync, readlinkSync, unlinkSync, rmdirSync, symlinkSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

const ROOT = join(import.meta.dirname, "..");
const OUT = join(ROOT, ".vercel", "output");
const CRED = join(ROOT, "production-credentials.local.txt");

function fail(msg) { console.error(`deploy-web: ${msg}`); process.exit(1); }

if (!existsSync(CRED)) fail("production-credentials.local.txt not found — nothing to deploy with.");
const cred = Object.fromEntries(
  readFileSync(CRED, "utf-8").split(/\r?\n/).map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2]]),
);
for (const k of ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "QSTASH_URL", "QSTASH_TOKEN", "WORKER_CALLBACK_SECRET", "PROD_APP_DATABASE_PASSWORD"]) {
  if (!cred[k]) fail(`${k} missing from the credentials sheet`);
}

const env = {
  ...process.env,
  DEV_USER_EMAIL: "",
  MEDIA_DRIVER: "r2",
  JOBS_DRIVER: "queue",
  JOBS_CLUB_VARIANTS: "false",
  WORKER_URL: "https://taylorvowell--swingsage-ingress.modal.run/jobs",
  WORKER_CLUB_DETECTOR: "/mnt/models/app/runs/clubhead/weights/best.pt",
  APP_INTERNAL_BASE_URL: "https://golf-pi-eight.vercel.app",
  APP_DATABASE_URL: `postgresql://swingsage_app.nprxxjeavdlsqthnofof:${cred.PROD_APP_DATABASE_PASSWORD}@aws-0-us-east-1.pooler.supabase.com:5432/postgres`,
  R2_ACCOUNT_ID: cred.R2_ACCOUNT_ID,
  R2_ACCESS_KEY_ID: cred.R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY: cred.R2_SECRET_ACCESS_KEY,
  QSTASH_URL: cred.QSTASH_URL,
  QSTASH_TOKEN: cred.QSTASH_TOKEN,
  WORKER_CALLBACK_SECRET: cred.WORKER_CALLBACK_SECRET,
};

// 1. Pristine build — a dirty .next mixes chunk graphs across builds.
rmSync(join(ROOT, "apps", "web", ".next"), { recursive: true, force: true });
rmSync(OUT, { recursive: true, force: true });
console.log("building (vercel build --prod)…");
execSync("vercel build --prod", { cwd: ROOT, env, stdio: "inherit" });

// 2. Symlink targets: backslash → forward slash.
let linksFixed = 0;
const walk = (dir, fn) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    fn(p);
    let st; try { st = lstatSync(p); } catch { continue; }
    if (st.isDirectory() && !st.isSymbolicLink()) walk(p, fn);
  }
};
walk(OUT, (p) => {
  let st; try { st = lstatSync(p); } catch { return; }
  if (!st.isSymbolicLink()) return;
  const t = readlinkSync(p);
  if (!t.includes("\\")) return;
  try { unlinkSync(p); } catch { rmdirSync(p); }
  symlinkSync(t.replaceAll("\\", "/"), p, "dir");
  linksFixed++;
});

// 3+4. Function manifests: strip local machine state, inject the under-traced runtime.
const ALLOWED = ["apps/web", "packages", "node_modules", ".vercel", ".npmrc", "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "tsconfig"];
const collect = (base, filter = () => true) => {
  const acc = [];
  if (!existsSync(join(ROOT, base))) return acc;
  const rec = (dir) => {
    for (const name of readdirSync(join(ROOT, dir))) {
      const rel = `${dir}/${name}`;
      const st = statSync(join(ROOT, rel));
      if (st.isDirectory()) rec(rel);
      else if (!rel.endsWith(".map") && !rel.endsWith(".d.ts") && filter(rel)) acc.push(rel.replaceAll("\\", "/"));
    }
  };
  rec(base);
  return acc;
};
const inject = [
  ...collect("apps/web/.next/server/chunks"),
  ...collect("apps/web/.next/server/pages", (r) => r.endsWith(".html")),
  // Next's routing manifests. Without them every DYNAMIC route ([id] segments) dies at
  // runtime with "Invariant: The manifests singleton was not initialized" while static paths
  // work — which reads as an intermittent connection, not a packaging bug (2026-08-23).
  ...collect("apps/web/.next", (r) => !r.slice("apps/web/.next/".length).includes("/")),
  ...collect("apps/web/.next/server", (r) => !r.slice("apps/web/.next/server/".length).includes("/")),
  ...collect("apps/web/.next/server/app", (r) => r.endsWith(".json") || r.includes("manifest")),
  ...collect("node_modules/next/dist/compiled/next-server"),
  ...collect("node_modules/next/dist", (r) => r.endsWith(".external.js") || r.includes("/build/adapter/")),
  ...["server", "lib", "shared", "build", "api", "client", "pages"].flatMap((s) => collect(`node_modules/next/dist/${s}`)),
  ...["@swc/helpers", "styled-jsx", "postcss", "caniuse-lite", "busboy", "nanoid", "source-map-js", "picocolors", "streamsearch", "react", "react-dom", "scheduler"].flatMap((p) => collect(`node_modules/${p}`)),
  // The R2 driver's SDK: turbopack externalizes @aws-sdk/client-s3 behind a hashed alias in
  // apps/web/.next/node_modules, which the fileset omits — without these the upload endpoint
  // 500s with "Cannot find module '@aws-sdk/client-s3-<hash>'" (2026-08-23, mid-import).
  ...["@aws-sdk", "@smithy", "@aws-crypto", "@aws", "fast-xml-parser", "strnum", "tslib", "bowser", "uuid", "mnemonist", "obliterator"].flatMap((p) => collect(`node_modules/${p}`)),
];
let stripped = 0, patched = 0;
const patchConfigs = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = lstatSync(p);
    if (st.isDirectory() && !st.isSymbolicLink()) patchConfigs(p);
    else if (name === ".vc-config.json") {
      const d = JSON.parse(readFileSync(p, "utf-8"));
      const fpm = d.filePathMap;
      if (!fpm || typeof fpm !== "object") continue;
      let changed = false;
      for (const k of Object.keys(fpm)) {
        const rel = k.replaceAll("\\", "/").replace(/^\.\//, "");
        const base = rel.split("/").pop();
        if (base.startsWith(".env") || !ALLOWED.some((a) => rel.startsWith(a))) {
          delete fpm[k]; stripped++; changed = true;
        }
      }
      if (Object.keys(fpm).some((k) => k.includes("next-server"))) {
        const n0 = Object.keys(fpm).length;
        for (const rel of inject) if (!(rel in fpm)) fpm[rel] = rel;
        if (Object.keys(fpm).length !== n0) changed = true;
      }
      if (changed) { writeFileSync(p, JSON.stringify(d)); patched++; }
    }
  }
};
patchConfigs(join(OUT, "functions"));

// Turbopack's externals aliases live in apps/web/.next/node_modules as ABSOLUTE symlinks into
// the repo's node_modules — meaningless on Linux, and walking through them re-uploads the
// whole target with a name conflict (server-side ENOTDIR). Rewrite each alias to a RELATIVE
// link (its target ships via the inject list) and register only the link itself.
const aliasRoot = join(ROOT, "apps", "web", ".next", "node_modules");
const aliasEntries = [];
if (existsSync(aliasRoot)) {
  const scopes = readdirSync(aliasRoot);
  for (const scope of scopes) {
    for (const name of readdirSync(join(aliasRoot, scope))) {
      const p = join(aliasRoot, scope, name);
      if (!lstatSync(p).isSymbolicLink()) continue;
      const target = readlinkSync(p).replaceAll("\\", "/");
      const real = target.slice(target.lastIndexOf("node_modules/"));
      try { unlinkSync(p); } catch { rmdirSync(p); }
      symlinkSync(`../../../../../${real}`, p, "dir");
      aliasEntries.push(`apps/web/.next/node_modules/${scope}/${name}`);
    }
  }
}
if (aliasEntries.length) {
  const reg = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      const st = lstatSync(p);
      if (st.isDirectory() && !st.isSymbolicLink()) reg(p);
      else if (name === ".vc-config.json") {
        const d = JSON.parse(readFileSync(p, "utf-8"));
        if (d.filePathMap && Object.keys(d.filePathMap).some((k) => k.includes("next-server"))) {
          for (const rel of aliasEntries) d.filePathMap[rel] = rel;
          writeFileSync(p, JSON.stringify(d));
        }
      }
    }
  };
  reg(join(OUT, "functions"));
}
console.log(`fixups: ${linksFixed} symlinks, ${stripped} stripped entries, ${patched} manifests patched, ${inject.length} runtime files injected, ${aliasEntries.length} externals aliases relinked`);

// 5. Ship it.
console.log("deploying (vercel deploy --prebuilt --prod)…");
execSync("vercel deploy --prebuilt --prod --yes", { cwd: ROOT, env, stdio: "inherit" });

// 6. Smoke — the three cheap truths.
const smoke = spawnSync("curl", ["-s", "-o", "/dev/null", "-w", "%{http_code}", "-m", "30", "https://www.swingsage.io/api/v1/client"], { encoding: "utf-8" });
console.log(`smoke /api/v1/client: ${smoke.stdout} (want 200)`);
