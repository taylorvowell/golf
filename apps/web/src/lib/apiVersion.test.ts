import { CLIENT_VERSION_HEADER } from "@swingsage/schema/contract";
import { describe, expect, it } from "vitest";

import {
  CURRENT_CLIENT_VERSION,
  MINIMUM_CLIENT_VERSION,
  clientConfig,
  guardClientVersion,
  versionHeaders,
} from "./apiVersion";

/**
 * The forced-upgrade path, from the server's side.
 *
 * Both directions matter and only one is obvious. Serving a build that is too old is the failure
 * everyone thinks of; 426-ing a caller that should have been served is the one that takes the
 * whole instructor workspace down, because the web app sends no version header at all.
 */

const req = (headers: Record<string, string> = {}) =>
  new Request("https://swingsage.test/api/v1/swings", { headers });

describe("guardClientVersion", () => {
  it("serves a caller that sends no version — the web app is deployed with this server", () => {
    expect(guardClientVersion(req())).toBeNull();
  });

  it("serves a build at the floor", () => {
    expect(guardClientVersion(req({ [CLIENT_VERSION_HEADER]: MINIMUM_CLIENT_VERSION }))).toBeNull();
  });

  it("serves a build above the floor", () => {
    expect(guardClientVersion(req({ [CLIENT_VERSION_HEADER]: "99.0.0" }))).toBeNull();
  });

  it("426s a build below the floor, with a body it can render", async () => {
    // 0.0.0 is also what an unparseable version sorts as, which is the right default: a client
    // that cannot state its version legibly is not one to trust with a golfer's data.
    const res = guardClientVersion(req({ [CLIENT_VERSION_HEADER]: "0.0.0-broken" }));
    expect(res?.status).toBe(426);

    const body = await res!.json();
    expect(body.error).toBe("upgrade_required");
    expect(body.minimumVersion).toBe(MINIMUM_CLIENT_VERSION);
    expect(body.currentVersion).toBe(CURRENT_CLIENT_VERSION);
    expect(typeof body.message).toBe("string");
  });

  it("names the right store for the platform that asked", async () => {
    const android = guardClientVersion(
      req({ [CLIENT_VERSION_HEADER]: "0.0.0", "x-swingsage-platform": "android" }),
    );
    expect((await android!.json()).storeUrl).toContain("play.google.com");

    const ios = guardClientVersion(
      req({ [CLIENT_VERSION_HEADER]: "0.0.0", "x-swingsage-platform": "ios" }),
    );
    expect((await ios!.json()).storeUrl).toContain("apps.apple.com");
  });

  it("returns a null store link rather than a wrong one for an unknown platform", async () => {
    const res = guardClientVersion(req({ [CLIENT_VERSION_HEADER]: "0.0.0" }));
    expect((await res!.json()).storeUrl).toBeNull();
  });

  it("never caches a 426 — raising the floor must take effect immediately", () => {
    const res = guardClientVersion(req({ [CLIENT_VERSION_HEADER]: "0.0.0" }));
    expect(res?.headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("clientConfig", () => {
  const cfg = clientConfig();

  it("answers the version floor and the current release", () => {
    expect(cfg.minimumVersion).toBe(MINIMUM_CLIENT_VERSION);
    expect(cfg.currentVersion).toBe(CURRENT_CLIENT_VERSION);
  });

  it("lists v1 as live", () => {
    expect(cfg.supportedApiVersions).toContain("v1");
    expect(cfg.apiVersion).toBe("v1");
  });

  it("states the artifact schema range a renderer must cope with", () => {
    // Stored artifacts are served as written, so the floor is a real obligation on the client,
    // not a formality — see D41.
    expect(cfg.minimumArtifactSchema).toBeLessThanOrEqual(cfg.currentArtifactSchema);
    expect(cfg.currentArtifactSchema).toBeGreaterThanOrEqual(9);
  });
});

describe("versionHeaders", () => {
  it("states the serving version on every response", () => {
    expect(versionHeaders()["x-swingsage-api-version"]).toBe("v1");
  });

  it("does not announce a deprecation for a version that has none", () => {
    expect(versionHeaders("v1").Deprecation).toBeUndefined();
    expect(versionHeaders("v1").Sunset).toBeUndefined();
  });
});
