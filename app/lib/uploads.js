/**
 * Upload rules (D9) — pure helpers shared by the upload service and tests.
 */

/** @type {Readonly<Record<string, string>>} content type → container label */
export const ALLOWED_VIDEO_TYPES = Object.freeze({
  "video/mp4": "MP4",
  "video/quicktime": "MOV",
  "video/webm": "WebM",
});

/** D9: ≤ 200,000,000 bytes (stays under Stream's 200 MB basic-upload cap whichever MB definition it uses). */
export const MAX_UPLOAD_BYTES = 200_000_000;

/** D9: ≤ 180 seconds, sent to Stream as maxDurationSeconds. */
export const MAX_DURATION_SECONDS = 180;

/** How long a one-time Stream upload URL stays valid. */
export const UPLOAD_URL_TTL_MS = 30 * 60 * 1000;

const MAX_TITLE_LENGTH = 120;
const MAX_FILENAME_LENGTH = 255;

/**
 * Derives a readable default title from a filename: drops the extension, control characters and
 * repeated whitespace; never returns an empty string.
 * @param {string} filename
 */
export function titleFromFilename(filename) {
  const base = String(filename ?? "")
    .split(/[\\/]/)
    .pop()
    .replace(/\.[A-Za-z0-9]{1,5}$/, "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/[_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (base || "Untitled video").slice(0, MAX_TITLE_LENGTH);
}

/**
 * Validates the body of POST /app/api/uploads. Unknown fields are ignored (never used).
 * @param {unknown} body
 * @returns {{ ok: true, value: { filename: string, contentType: string, sizeBytes: number, title: string } }
 *         | { ok: false, code: string, message: string }}
 */
export function validateUploadRequest(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, code: "INVALID_BODY", message: "Send a JSON object." };
  }
  const { filename, contentType, sizeBytes, rightsConfirmed } = /** @type {Record<string, unknown>} */ (body);

  if (typeof filename !== "string" || filename.trim() === "" || filename.length > MAX_FILENAME_LENGTH) {
    return { ok: false, code: "INVALID_FILENAME", message: "The file name is missing or too long." };
  }
  if (typeof contentType !== "string" || !Object.hasOwn(ALLOWED_VIDEO_TYPES, contentType)) {
    return { ok: false, code: "UNSUPPORTED_TYPE", message: "Upload an MP4, MOV or WebM video." };
  }
  if (!Number.isSafeInteger(sizeBytes) || /** @type {number} */ (sizeBytes) < 1) {
    return { ok: false, code: "INVALID_SIZE", message: "The file size is missing or invalid." };
  }
  if (/** @type {number} */ (sizeBytes) > MAX_UPLOAD_BYTES) {
    return { ok: false, code: "TOO_LARGE", message: "Videos can be up to 200 MB." };
  }
  if (rightsConfirmed !== true) {
    return {
      ok: false,
      code: "RIGHTS_NOT_CONFIRMED",
      message: "Confirm that you own or have permission to use this video.",
    };
  }
  return {
    ok: true,
    value: {
      filename: filename.trim(),
      contentType,
      sizeBytes: /** @type {number} */ (sizeBytes),
      title: titleFromFilename(filename),
    },
  };
}
