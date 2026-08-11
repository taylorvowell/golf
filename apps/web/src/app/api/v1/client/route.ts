import { clientConfig, versionHeaders } from "@/lib/apiVersion";

/**
 * GET /api/v1/client — what a native build asks for before it trusts anything else.
 *
 * Unauthenticated on purpose. A build too old to be served must still be able to find out that
 * it is too old; putting this behind sign-in would mean the only way to learn you need to
 * upgrade is a failed sign-in, which reads as "the app is broken".
 *
 * Answers the version floor, every API version still live, and the artifact schema range a
 * renderer has to cope with. Never cached: raising the floor is an operational act and must take
 * effect on the next launch, not after a CDN TTL.
 */
export async function GET() {
  return Response.json(clientConfig(), {
    headers: { "Cache-Control": "no-store", ...versionHeaders() },
  });
}
