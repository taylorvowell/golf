import {
  API_VERSIONS,
  CLIENT_VERSION_HEADER,
  CURRENT_API_VERSION,
  CURRENT_ARTIFACT_SCHEMA,
  MINIMUM_ARTIFACT_SCHEMA,
  isClientTooOld,
  type ApiDeprecation,
  type ApiVersion,
  type ClientConfig,
  type UpgradeRequired,
} from "@swingsage/schema/contract";

/**
 * The server half of version negotiation. The policy is D41; this is where it is enforced.
 *
 * Every route lives under `/api/v1/`. Nothing is served unversioned — an unversioned path is a
 * promise you did not mean to make, and once a build in a store is calling it there is no way to
 * take it back. Inside a version, bodies only gain fields. A change that cannot be made
 * additively mints `/api/v2/` and `v1` keeps answering until its published sunset.
 *
 * `guardClientVersion` is the escape hatch for the case where compatibility is genuinely
 * impossible: 426 with a body the client can render as a real screen. It must be rare, and it
 * must exist — the alternative is a build that fails every request with nothing to show for it.
 */

/**
 * The oldest native build still served. Environment-overridable because raising it is an
 * operational act — a deploy, not a code change — and because the answer differs per
 * environment while a build is being rolled out.
 */
export const MINIMUM_CLIENT_VERSION = process.env.SWINGSAGE_MIN_CLIENT_VERSION ?? "0.1.0";

/** The newest build the server knows about; what the store is expected to be offering. */
export const CURRENT_CLIENT_VERSION = process.env.SWINGSAGE_CURRENT_CLIENT_VERSION ?? "0.1.0";

/**
 * Versions still answering but scheduled for removal. Empty today — v1 is the first — and the
 * shape is here so that adding v2 is a data change rather than a design decision taken under
 * time pressure.
 */
export const DEPRECATED_API_VERSIONS: ApiDeprecation[] = [];

const STORE_URLS: Record<string, string> = {
  ios: "https://apps.apple.com/app/swingsage",
  android: "https://play.google.com/store/apps/details?id=dev.swingsage.app",
};

export function clientVersionOf(req: Request): string | null {
  return req.headers.get(CLIENT_VERSION_HEADER);
}

/** `x-swingsage-platform: ios|android`, used only to pick the right store link. */
function storeUrlFor(req: Request): string | null {
  return STORE_URLS[(req.headers.get("x-swingsage-platform") ?? "").toLowerCase()] ?? null;
}

/**
 * A 426 when the caller is below the floor, otherwise null.
 *
 * Deliberately fails OPEN for a caller that sends no version header. The web app is deployed
 * with this server and cannot lag it, and neither can a server-to-server call; 426-ing them
 * would take the instructor workspace down over a guard meant for phones.
 */
export function guardClientVersion(req: Request): Response | null {
  if (!isClientTooOld(clientVersionOf(req), MINIMUM_CLIENT_VERSION)) return null;

  const body: UpgradeRequired = {
    error: "upgrade_required",
    message:
      "This version of SwingSage is too old to read your swings safely. Update to continue.",
    minimumVersion: MINIMUM_CLIENT_VERSION,
    currentVersion: CURRENT_CLIENT_VERSION,
    storeUrl: storeUrlFor(req),
  };
  return Response.json(body, {
    status: 426,
    headers: { "Cache-Control": "no-store", "x-swingsage-api-version": CURRENT_API_VERSION },
  });
}

/** What `/api/v1/client` answers. Unauthenticated: a build too old to sign in must still be
 *  able to learn that it is too old. */
export function clientConfig(): ClientConfig {
  return {
    apiVersion: CURRENT_API_VERSION,
    minimumVersion: MINIMUM_CLIENT_VERSION,
    currentVersion: CURRENT_CLIENT_VERSION,
    supportedApiVersions: [...API_VERSIONS],
    deprecatedApiVersions: DEPRECATED_API_VERSIONS,
    minimumArtifactSchema: MINIMUM_ARTIFACT_SCHEMA,
    currentArtifactSchema: CURRENT_ARTIFACT_SCHEMA,
  };
}

/**
 * `Deprecation` / `Sunset` are the standard headers (RFC 8594 and its Deprecation companion), so
 * a client learns a version is going away from every response rather than only from a config
 * call it may never make.
 */
export function versionHeaders(version: ApiVersion = CURRENT_API_VERSION): Record<string, string> {
  const headers: Record<string, string> = { "x-swingsage-api-version": version };
  const dep = DEPRECATED_API_VERSIONS.find((d) => d.version === version);
  if (dep) {
    headers.Deprecation = "true";
    headers.Sunset = new Date(dep.sunsetOn).toUTCString();
    if (dep.replacedBy) headers.Link = `</api/${dep.replacedBy}>; rel="successor-version"`;
  }
  return headers;
}
