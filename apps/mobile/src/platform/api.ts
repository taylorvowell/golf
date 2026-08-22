import { Platform } from "react-native";
import {
  CLIENT_VERSION_HEADER,
  CURRENT_API_VERSION,
  type ApiError,
  type ClientConfig,
  type UpgradeRequired,
} from "@swingsage/schema/contract";

import { CLIENT_VERSION } from "./version";

/**
 * The only way this app talks to the server.
 *
 * Two properties matter and neither can be retrofitted once builds are in a store:
 *
 *   1. Every request carries an explicit API version in the PATH (`/api/v1/...`) and this
 *      build's version in a header. The server needs both — the path to route, the header to
 *      decide whether this build is still safe to serve.
 *   2. A 426 is not an error to retry. It means this build is below the floor and must show a
 *      real screen. `ApiClientError.upgradeRequired` carries the body so the caller can render
 *      it instead of a spinner that never resolves.
 *
 * A failed request that silently retries forever is how "the app is broken" gets reported
 * instead of "the app needs updating", and only one of those a user can act on.
 */

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  /** Present only on 426 — the body the upgrade screen renders. */
  readonly upgradeRequired?: UpgradeRequired;

  constructor(status: number, code: string, message: string, upgradeRequired?: UpgradeRequired) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = code;
    this.upgradeRequired = upgradeRequired;
  }

  get isUpgradeRequired(): boolean {
    return this.status === 426;
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  clientVersion?: string;
  platform?: string;
  fetchImpl?: typeof fetch;
  /**
   * The current access token, resolved per request. A function, not a string: supabase-js
   * refreshes tokens in the background, so a token captured when the client was constructed is
   * stale by the first long upload and the request comes back 401 for no visible reason.
   *
   * Returning null is normal — it is what "signed out" looks like — and produces a request with
   * no Authorization header rather than one with an empty credential.
   */
  accessToken?: () => Promise<string | null>;
}

const isUpgradeBody = (b: unknown): b is UpgradeRequired =>
  typeof b === "object" && b !== null && (b as ApiError).error === "upgrade_required";

/**
 * Long enough for a cold LAN fetch of the largest artifact, short enough that "unreachable"
 * arrives while the golfer is still looking. Overridable per call for anything genuinely slow.
 */
const DEFAULT_TIMEOUT_MS = 12_000;

export class ApiClient {
  private readonly baseUrl: string;
  private readonly clientVersion: string;
  private readonly platform: string;
  private readonly doFetch: typeof fetch;
  private readonly accessToken: () => Promise<string | null>;

  constructor({ baseUrl, clientVersion, platform, fetchImpl, accessToken }: ApiClientOptions) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.clientVersion = clientVersion ?? CLIENT_VERSION;
    this.platform = platform ?? Platform.OS;
    this.doFetch = fetchImpl ?? fetch;
    this.accessToken = accessToken ?? (async () => null);
  }

  /** `swings` -> `<base>/api/v1/swings`. Callers never write the version themselves; that is
   *  how one forgotten path ends up permanently unversioned. */
  url(path: string): string {
    return `${this.baseUrl}/api/${CURRENT_API_VERSION}/${path.replace(/^\/+/, "")}`;
  }

  private async headers(extra?: HeadersInit): Promise<Headers> {
    const h = new Headers(extra);
    h.set(CLIENT_VERSION_HEADER, this.clientVersion);
    h.set("x-swingsage-platform", this.platform);
    if (!h.has("Accept")) h.set("Accept", "application/json");
    // A native client has no cookie jar, so the session travels as a bearer token. A caller that
    // set its own Authorization header keeps it — that is how a one-off signed request stays
    // possible without a second client.
    if (!h.has("Authorization")) {
      const token = await this.accessToken();
      if (token) h.set("Authorization", `Bearer ${token}`);
    }
    return h;
  }

  async request<T>(path: string, init: RequestInit = {}, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
    /**
     * Every request times out. React Native's OkHttp stack ships with NO timeouts — a phone that
     * half-loses range Wi-Fi leaves fetch neither resolving nor rejecting for minutes, and the
     * carefully separated `unreachable` states are never reached: the golfer just gets a spinner.
     * The timeout aborts through the same controller a caller-supplied signal feeds into, so a
     * screen's own AbortController still cancels early and its AbortError is re-thrown untouched.
     */
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const external = init.signal;
    if (external) {
      if (external.aborted) controller.abort();
      else external.addEventListener("abort", () => controller.abort(), { once: true });
    }

    let res: Response;
    try {
      res = await this.doFetch(this.url(path), {
        ...init,
        signal: controller.signal,
        headers: await this.headers(init.headers),
      });
    } catch (err) {
      if (controller.signal.aborted && !external?.aborted) {
        throw new ApiClientError(0, "timeout", `no answer from ${path} within ${timeoutMs}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }

    if (res.status === 426) {
      const body: unknown = await res.json().catch(() => null);
      throw new ApiClientError(
        426,
        "upgrade_required",
        isUpgradeBody(body) ? (body.message ?? "This version is no longer supported.")
          : "This version is no longer supported.",
        isUpgradeBody(body) ? body : undefined,
      );
    }

    if (!res.ok) {
      const body: unknown = await res.json().catch(() => null);
      const err = (body ?? {}) as ApiError;
      throw new ApiClientError(res.status, err.error ?? "http_error",
        err.message ?? `${res.status} from ${path}`);
    }

    return (await res.json()) as T;
  }

  /**
   * A media URL plus the headers that authorize it — for `Image` and `expo-video`, which fetch
   * bytes themselves rather than going through `request()`.
   *
   * Both `/thumb` and `/video` require a bearer token. A `<Image source={{ uri }}>` without one
   * gets a 401 and renders as **nothing** — no error, no callback most people wire up — so it
   * reads as "the analyzer never produced a thumbnail" rather than as an auth failure. That is a
   * bug you can stare straight at, which is why the URL and its headers are produced together
   * here and never separately.
   */
  async mediaSource(path: string): Promise<{ uri: string; headers: Record<string, string> }> {
    const token = await this.accessToken();
    const headers: Record<string, string> = { [CLIENT_VERSION_HEADER]: this.clientVersion };
    if (token) headers.Authorization = `Bearer ${token}`;
    return { uri: this.url(path), headers };
  }

  /**
   * An upload target the SERVER named, resolved and authorized — for callers that send the bytes
   * themselves (`expo-file-system`'s uploader), the way `mediaSource` serves the ones that fetch
   * them.
   *
   * Ingest hands back either a signed storage URL or a route on this server, and **the client
   * must not branch on which** — it sends the file exactly as described. The one thing that has
   * to be decided is authorization, and that follows from the URL rather than from the storage
   * driver: an absolute URL carries its own signature and must NOT receive our bearer token
   * (handing a Supabase-signed URL an Authorization header is how a working upload starts
   * 400ing), while a path on this server has no signature and needs one.
   */
  async uploadTarget(
    url: string,
    extra?: Record<string, string>,
  ): Promise<{ url: string; headers: Record<string, string> }> {
    const headers: Record<string, string> = {
      ...extra,
      [CLIENT_VERSION_HEADER]: this.clientVersion,
    };
    if (/^https?:\/\//i.test(url)) return { url, headers };
    const token = await this.accessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    return { url: `${this.baseUrl}/${url.replace(/^\/+/, "")}`, headers };
  }

  /**
   * The launch call. Unauthenticated, so a build too old to sign in still learns why.
   *
   * It goes through `request`, which means a server that has already raised the floor past this
   * build answers 426 here — at launch, before anything else is attempted — rather than on the
   * first swing the golfer opens.
   */
  clientConfig(): Promise<ClientConfig> {
    return this.request<ClientConfig>("client");
  }
}
