const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

/**
 * WORKAROUND (2026-08-18): RN 0.86's Kotlin `MultipartStreamReader` dies mid-download on
 * Metro's chunked multipart bundle response — okhttp throws
 * `ProtocolException: Expected leading [0-9a-fA-F] character but was 0xd` and the dev
 * client sits on "Loading from …" forever. Content-dependent (today's bundle hits it,
 * last week's did not), reproduced against two separate Metro instances, and upstream
 * closed the report unfixed (facebook/react-native#56034).
 *
 * The multipart response exists only to stream load-progress events. Stripping the
 * `Accept: multipart/mixed` header from bundle requests makes Metro answer with a plain
 * `Content-Length` body, which the client's non-multipart path handles fine — the cost is
 * the download percentage on the dev-client splash, nothing else. Delete this file's
 * middleware once an RN release fixes the reader.
 */
const enhanceMiddleware = (middleware) => (req, res, next) => {
  if (req.url?.includes(".bundle") && req.headers.accept?.includes("multipart/mixed")) {
    req.headers.accept = "*/*";
  }
  return middleware(req, res, next);
};

config.server = { ...config.server, enhanceMiddleware };

module.exports = config;
