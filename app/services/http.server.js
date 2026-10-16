/**
 * Small JSON helpers for action-only API routes. Error responses never include internal details.
 */
import { UploadError } from "./uploads.server.js";

export const MAX_JSON_BODY_BYTES = 4096;

/**
 * Reads and parses a small JSON request body.
 * @param {Request} request
 * @param {number} [maxBytes]
 */
export async function readJsonBody(request, maxBytes = MAX_JSON_BODY_BYTES) {
  const type = request.headers.get("content-type") ?? "";
  if (!/^application\/json\b/i.test(type)) {
    throw new UploadError(415, "UNSUPPORTED_MEDIA_TYPE", "Send the request as JSON.");
  }
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new UploadError(413, "BODY_TOO_LARGE", "The request is too large.");
  }
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > maxBytes) {
    throw new UploadError(413, "BODY_TOO_LARGE", "The request is too large.");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new UploadError(400, "INVALID_JSON", "The request body isn't valid JSON.");
  }
}

/** @param {number} status @param {unknown} data */
export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/** 405 for anything but POST. */
export function methodNotAllowed() {
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}

/**
 * Converts expected errors to JSON responses; rethrows Responses (auth redirects) untouched.
 * Unexpected errors are logged by name only and returned as a generic 500.
 * @param {unknown} error
 * @param {Pick<Console, "error">} [logger]
 */
export function errorResponse(error, logger = console) {
  if (error instanceof Response) throw error;
  if (error instanceof UploadError) {
    return json({ error: { code: error.code, message: error.message } }, error.status);
  }
  logger.error("Unexpected API error", { error: error?.name, code: error?.code });
  return json({ error: { code: "INTERNAL_ERROR", message: "Something went wrong. Try again." } }, 500);
}
