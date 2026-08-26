#!/usr/bin/env node
/**
 * Find the S25+ and connect to it, without anyone reading numbers off a screen.
 *
 * Wireless debugging picks a **new random port every time it is toggled**, and this project used
 * to treat that as a hand-off: "tell me the IP:PORT". That was wrong, and Taylor said so on
 * 2026-08-22 — *"ive never had to give you the debug shit before just find it"*. The port is
 * discoverable from this machine in every case that matters, so it is discovered here.
 *
 * Three rungs, cheapest first:
 *
 *   1. **Already connected** — `adb devices` says so. Nothing to do.
 *   2. **The last port that worked**, cached in `.adb-phone.json` (gitignored). A port survives
 *      until wireless debugging is toggled, so across a reboot of THIS pc the cached one is
 *      usually still live. One TCP connect, instant.
 *   3. **The phone's STATIC address** (Taylor reserved 10.0.1.25 for it on 2026-08-26 — see
 *      docs/ENVIRONMENT.md). The port still randomizes on every wireless-debugging toggle
 *      (Android's design; only the PAIRING persists — which is why `adb connect` needs no
 *      re-pair), so this rung scans the one known host across the ephemeral range: ~20s
 *      worst-case instead of a whole-LAN sweep.
 *   4. **mDNS**, then a **port sweep of every ARP neighbour** — the fallback for the day the
 *      reservation changes. mDNS is the documented answer and works *sometimes* — it resolved
 *      the device on 2026-08-20 and returned nothing on 2026-08-11, 2026-08-22 and 2026-08-26.
 *
 *   node scripts/adb-phone.mjs            # connect, print the serial
 *   node scripts/adb-phone.mjs --quiet    # exit 0/1, print only the serial
 *   node scripts/adb-phone.mjs --fast     # rungs 1-2 only (no sweep) — the session probe's use
 */
import { execFile } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";
import { join } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const args = process.argv.slice(2);
const QUIET = args.includes("--quiet");
const FAST = args.includes("--fast");

const CACHE = join(process.cwd(), ".adb-phone.json");
/** The S25+'s DHCP reservation (Taylor, 2026-08-26; MAC 0c:32:3a:68:b3:83). Facts in
 *  docs/ENVIRONMENT.md — if the reservation ever moves, the ARP sweep below still finds it. */
const PHONE_IP = "10.0.1.25";
/** Wireless debugging has never been observed outside this range. */
const PORT_LO = 30000;
const PORT_HI = 50000;
/** Enough concurrent sockets to sweep 20k ports in ~20s without exhausting handles. */
const BATCH = 1000;
const CONNECT_MS = 400;

const log = (s) => {
  if (!QUIET) console.log(s);
};

async function adb(argv) {
  try {
    const { stdout } = await exec("adb", argv, { timeout: 15000 });
    return stdout.trim();
  } catch {
    return "";
  }
}

/** A device line adb calls `device` (not `offline`, not `unauthorized`). */
async function online() {
  const out = await adb(["devices"]);
  return out
    .split("\n")
    .slice(1)
    .map((l) => l.trim())
    .filter((l) => /\sdevice$/.test(l))
    .map((l) => l.split(/\s+/)[0])
    .filter((s) => !s.startsWith("emulator-"));
}

function tcpOpen(host, port, timeout = CONNECT_MS) {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    const done = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeout);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

/** Every 10.x neighbour this PC has spoken to — the phone is one of them. */
async function arpHosts() {
  try {
    const { stdout } = await exec("arp", ["-a"], { timeout: 10000 });
    return [...new Set(stdout.match(/10\.\d+\.\d+\.\d+/g) ?? [])].filter(
      (ip) => !ip.endsWith(".255") && !ip.endsWith(".1"),
    );
  } catch {
    return [];
  }
}

async function connect(addr) {
  const out = await adb(["connect", addr]);
  if (!/^connected|already connected/i.test(out)) return false;
  // `connect` reports success for a socket that is not actually adb, so confirm with the list.
  return (await online()).includes(addr);
}

function readCache() {
  if (!existsSync(CACHE)) return null;
  try {
    return JSON.parse(readFileSync(CACHE, "utf8"));
  } catch {
    return null;
  }
}

function writeCache(addr) {
  try {
    writeFileSync(CACHE, `${JSON.stringify({ addr, at: new Date().toISOString() }, null, 2)}\n`);
  } catch {
    // A cache that cannot be written costs one sweep next time, which is not worth failing over.
  }
}

async function sweep(host) {
  for (let start = PORT_LO; start < PORT_HI; start += BATCH) {
    const ports = [];
    for (let p = start; p < Math.min(start + BATCH, PORT_HI); p += 1) ports.push(p);
    const hits = await Promise.all(ports.map((p) => tcpOpen(host, p)));
    const found = ports.filter((_, i) => hits[i]);
    for (const port of found) {
      if (await connect(`${host}:${port}`)) return `${host}:${port}`;
    }
  }
  return null;
}

async function main() {
  const already = await online();
  if (already.length) {
    log(`phone already connected — ${already[0]}`);
    if (QUIET) console.log(already[0]);
    writeCache(already[0]);
    return 0;
  }

  const cached = readCache()?.addr;
  if (cached) {
    const [host, port] = cached.split(":");
    if (await tcpOpen(host, Number(port), 700)) {
      if (await connect(cached)) {
        log(`phone reconnected on the cached port — ${cached}`);
        if (QUIET) console.log(cached);
        return 0;
      }
    }
    log(`cached ${cached} is dead${FAST ? "" : " — discovering"}`);
  }

  if (FAST) return 1;

  // The static address first: one host, ~20s worst-case, deterministic while the phone is on
  // the LAN with wireless debugging enabled.
  log(`scanning the phone's static address ${PHONE_IP} (${PORT_LO}-${PORT_HI})…`);
  const staticHit = await sweep(PHONE_IP);
  if (staticHit) {
    log(`phone found on its static address — ${staticHit}`);
    if (QUIET) console.log(staticHit);
    writeCache(staticHit);
    return 0;
  }

  // mDNS: cheap, occasionally right, and the documented route.
  const mdns = await adb(["mdns", "services"]);
  const service = /(\d+\.\d+\.\d+\.\d+:\d+)/.exec(mdns);
  if (service && (await connect(service[1]))) {
    log(`phone found over mDNS — ${service[1]}`);
    if (QUIET) console.log(service[1]);
    writeCache(service[1]);
    return 0;
  }

  const hosts = (await arpHosts()).filter((ip) => ip !== PHONE_IP);
  log(`sweeping ${PORT_LO}-${PORT_HI} on ${hosts.length} LAN neighbour(s)…`);
  for (const host of hosts) {
    const addr = await sweep(host);
    if (addr) {
      log(`phone found by port sweep — ${addr}`);
      if (QUIET) console.log(addr);
      writeCache(addr);
      return 0;
    }
  }

  log("no phone found. Wireless debugging is off, or the phone is on another network.");
  return 1;
}

process.exit(await main());
