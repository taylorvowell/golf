import os from "node:os";
import type { NextConfig } from "next";

/**
 * Next 16 blocks /_next/* dev resources from any origin other than localhost. Reaching the
 * dev server by LAN IP therefore serves the server-rendered HTML but silently drops the
 * client bundle: the page looks right, nothing hydrates, and no canvas ever draws.
 *
 * Videos are filmed on phones and reviewed on them (the product spec UX notes), so LAN access is a
 * normal part of working on this. Enumerate this machine's own IPv4 addresses rather than
 * hardcoding one — the address is DHCP-assigned and changes on router reboots.
 */
function localAddresses(): string[] {
  const out = new Set<string>(["localhost", "127.0.0.1"]);
  for (const iface of Object.values(os.networkInterfaces())) {
    for (const net of iface ?? []) {
      if (net.family === "IPv4" && !net.internal) out.add(net.address);
    }
  }
  return [...out];
}

const nextConfig: NextConfig = {
  // Dev-only allowance; has no effect on a production build.
  allowedDevOrigins: localAddresses(),
  /**
   * `@swingsage/schema` is published as TypeScript source, not a build artifact — one generated
   * contract, compiled by whichever app consumes it, so there is no dist/ that can lag the
   * schema it came from. Next has to be told to transpile it like first-party code.
   */
  transpilePackages: ["@swingsage/schema"],
  experimental: {
    /**
     * Swing clips are tens to hundreds of megabytes, and Next's default is 10 MB.
     *
     * The default does not reject an oversized body — it **buffers the first 10 MB and carries
     * on**, so the upload answers 200, a truncated MP4 lands in the store, and the failure
     * surfaces minutes later as `ffprobe` exiting 1 inside the analyzer. That is exactly how a
     * phone import failed on 2026-08-22: two stored files, both 10 MiB to within a few hundred
     * bytes, both unreadable.
     *
     * This only affects the LOCAL upload route (`swings/[id]/source`), which exists so the capture
     * loop runs with no cloud account; with a signing driver the bytes never reach this server at
     * all. `media-pipeline` replaces that route with resumable chunks and this ceiling stops
     * mattering — until then the route also verifies `content-length` against what it received,
     * so a truncation can never again be stored as if it were a whole video.
     */
    proxyClientMaxBodySize: "1gb",
  },
};

export default nextConfig;
