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
};

export default nextConfig;
