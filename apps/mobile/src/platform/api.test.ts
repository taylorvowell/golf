import { CLIENT_VERSION_HEADER } from "@swingsage/schema/contract";
import { ApiClient, ApiClientError } from "./api";
import { CLIENT_VERSION } from "./version";

/**
 * The version contract, from the client's side.
 *
 * These are cheap tests of an expensive mistake: once builds are in a store, a client that
 * forgets its version header, calls an unversioned path, or treats a 426 as a retryable error is
 * not fixable from the server.
 */

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

/**
 * `respond` is a FACTORY, not a Response. A Response body can only be read once, so a shared
 * instance makes the second call in a test see an already-consumed stream — which shows up as a
 * missing body rather than as an error, and reads like a bug in the client.
 */
function clientWith(respond: () => Response, accessToken?: () => Promise<string | null>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return respond();
  }) as unknown as typeof fetch;
  return {
    calls,
    api: new ApiClient({
      baseUrl: "https://api.example.test/",
      clientVersion: "1.2.3",
      platform: "android",
      fetchImpl,
      accessToken,
    }),
  };
}

describe("ApiClient", () => {
  it("puts the version in the path — a caller never writes it", async () => {
    const { api, calls } = clientWith(() => json(200, { swings: [] }));
    await api.request("swings");
    expect(calls[0].url).toBe("https://api.example.test/api/v1/swings");
  });

  it("does not double the slash when the caller writes one", async () => {
    const { api, calls } = clientWith(() => json(200, {}));
    await api.request("/swings/abc/analysis");
    expect(calls[0].url).toBe("https://api.example.test/api/v1/swings/abc/analysis");
  });

  it("identifies the build on every request", async () => {
    const { api, calls } = clientWith(() => json(200, {}));
    await api.request("swings");
    const headers = new Headers(calls[0].init?.headers);
    expect(headers.get(CLIENT_VERSION_HEADER)).toBe("1.2.3");
    expect(headers.get("x-swingsage-platform")).toBe("android");
  });

  it("turns a 426 into an upgrade, not a retryable error", async () => {
    const body = {
      error: "upgrade_required",
      message: "Too old.",
      minimumVersion: "2.0.0",
      currentVersion: "2.4.1",
      storeUrl: "https://play.google.com/store/apps/details?id=dev.swingsage.app",
    };
    const { api } = clientWith(() => json(426, body));

    await expect(api.request("swings")).rejects.toBeInstanceOf(ApiClientError);
    const err = (await api.request("swings").catch((e: unknown) => e)) as ApiClientError;
    expect(err.isUpgradeRequired).toBe(true);
    expect(err.upgradeRequired).toEqual(body);
  });

  it("still reports an upgrade when the body is unreadable", async () => {
    const { api } = clientWith(() => new Response("<html>gateway</html>", { status: 426 }));
    const err = (await api.request("swings").catch((e: unknown) => e)) as ApiClientError;
    expect(err.isUpgradeRequired).toBe(true);
    expect(err.upgradeRequired).toBeUndefined();
  });

  it("carries the server's error code through on an ordinary failure", async () => {
    const { api } = clientWith(() => json(404, { error: "not_found", message: "no such swing" }));
    const err = (await api.request("swings/x").catch((e: unknown) => e)) as ApiClientError;
    expect(err.isUpgradeRequired).toBe(false);
    expect(err.code).toBe("not_found");
    expect(err.status).toBe(404);
  });

  it("sends the session as a bearer token", async () => {
    const { api, calls } = clientWith(() => json(200, {}), async () => "jwt-abc");
    await api.request("swings");
    expect(new Headers(calls[0].init?.headers).get("Authorization")).toBe("Bearer jwt-abc");
  });

  it("sends no Authorization header when signed out", async () => {
    // An empty credential is not the same as none: `Bearer ` reaches the server as a malformed
    // token and answers 401 where the honest answer is "this caller is anonymous".
    const { api, calls } = clientWith(() => json(200, {}), async () => null);
    await api.request("client");
    expect(new Headers(calls[0].init?.headers).has("Authorization")).toBe(false);
  });

  it("reads the token per request, not once at construction", async () => {
    // supabase-js refreshes in the background. A token captured when the client was built is
    // stale by the first long upload, and the request 401s for no reason the golfer can see.
    let token = "first";
    const { api, calls } = clientWith(() => json(200, {}), async () => token);
    await api.request("swings");
    token = "second";
    await api.request("swings");
    expect(new Headers(calls[0].init?.headers).get("Authorization")).toBe("Bearer first");
    expect(new Headers(calls[1].init?.headers).get("Authorization")).toBe("Bearer second");
  });

  it("leaves a caller's own Authorization header alone", async () => {
    const { api, calls } = clientWith(() => json(200, {}), async () => "session-token");
    await api.request("swings", { headers: { Authorization: "Bearer explicit" } });
    expect(new Headers(calls[0].init?.headers).get("Authorization")).toBe("Bearer explicit");
  });

  it("asks for the client config at the versioned path", async () => {
    const { api, calls } = clientWith(() => json(200, { apiVersion: "v1" }));
    await api.clientConfig();
    expect(calls[0].url).toBe("https://api.example.test/api/v1/client");
  });
});

describe("CLIENT_VERSION", () => {
  it("is the version app.json declares, not a hardcoded string", () => {
    // A build reporting the wrong version is worse than one reporting none: the server would
    // serve it under a floor it does not satisfy.
    const declared = (require("../../app.json") as { expo: { version: string } }).expo.version;
    expect(CLIENT_VERSION).toBe(declared);
    expect(CLIENT_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});
