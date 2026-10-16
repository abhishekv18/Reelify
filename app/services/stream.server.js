/**
 * Cloudflare Stream REST client (no SDK). Server-only.
 *
 * Base: https://api.cloudflare.com/client/v4/accounts/{CLOUDFLARE_ACCOUNT_ID}/stream
 * Auth: Authorization: Bearer {CLOUDFLARE_STREAM_API_TOKEN} (permission: Account › Stream › Edit)
 * Docs: https://developers.cloudflare.com/api/resources/stream/ and docs/STREAM.md
 *
 * Never put the API token, one-time upload URLs, signed tokens or response bodies in errors or logs.
 */

const API_BASE = "https://api.cloudflare.com/client/v4/accounts";
const DEFAULT_TIMEOUT_MS = 15_000;
// Stream video UIDs are Cloudflare-generated identifiers (max length 32). Restricting the charset keeps
// any value we put into a URL path from changing the path.
const UID = /^[A-Za-z0-9]{1,32}$/;
/** Returned by call() for a 404 when allow404 is set (distinct from a successful `result: null`). */
const NOT_FOUND = Symbol("notFound");

/** Missing or malformed Stream configuration. Names the variable, never its value. */
export class StreamConfigError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = "StreamConfigError";
  }
}

/** A Stream API call failed. `retryable` is true for network errors, timeouts, 429 and 5xx. */
export class StreamApiError extends Error {
  /**
   * @param {string} operation
   * @param {{ status?: number, codes?: number[], retryable: boolean, cause?: unknown }} info
   */
  constructor(operation, { status, codes = [], retryable, cause }) {
    super(
      `Cloudflare Stream ${operation} failed${status ? ` (HTTP ${status})` : " (network error)"}` +
        (codes.length ? ` [codes ${codes.join(",")}]` : ""),
    );
    this.name = "StreamApiError";
    this.operation = operation;
    this.status = status;
    this.codes = codes;
    this.retryable = retryable;
    if (cause) this.cause = cause;
  }
}

/** @param {string} uid */
export function assertStreamUid(uid) {
  if (typeof uid !== "string" || !UID.test(uid)) {
    throw new TypeError("Invalid Stream video uid.");
  }
  return uid;
}

/**
 * @param {Record<string, string | undefined>} [env]
 * @returns {{ accountId: string, apiToken: string }}
 */
export function readStreamConfig(env = process.env) {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const apiToken = env.CLOUDFLARE_STREAM_API_TOKEN?.trim();
  if (!accountId) throw new StreamConfigError("CLOUDFLARE_ACCOUNT_ID is not set.");
  if (!/^[0-9a-f]{32}$/i.test(accountId)) {
    throw new StreamConfigError("CLOUDFLARE_ACCOUNT_ID must be the 32-character account id.");
  }
  if (!apiToken) throw new StreamConfigError("CLOUDFLARE_STREAM_API_TOKEN is not set.");
  return { accountId, apiToken };
}

/**
 * @param {{ accountId: string, apiToken: string, fetch?: typeof fetch, timeoutMs?: number }} options
 */
export function createStreamClient({ accountId, apiToken, fetch: fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const base = `${API_BASE}/${encodeURIComponent(accountId)}/stream`;

  /**
   * @param {string} operation label used in errors
   * @param {string} path appended to the stream base ("" for the collection)
   * @param {{ method?: string, body?: unknown, query?: Record<string, string | number | boolean | undefined>, allow404?: boolean }} [options]
   */
  async function call(operation, path, { method = "GET", body, query, allow404 = false } = {}) {
    const url = new URL(base + path);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
    }

    let response;
    try {
      response = await fetchImpl(url, {
        method,
        headers: {
          Authorization: `Bearer ${apiToken}`,
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (cause) {
      throw new StreamApiError(operation, { retryable: true, cause: { name: cause?.name } });
    }

    if (allow404 && response.status === 404) return NOT_FOUND;

    /** @type {any} */
    let json = null;
    try {
      json = await response.json();
    } catch {
      json = null;
    }

    if (!response.ok || json?.success === false) {
      const codes = Array.isArray(json?.errors)
        ? json.errors.map((e) => e?.code).filter((c) => typeof c === "number")
        : [];
      // Some 404s come back as a Stream error code rather than an HTTP 404.
      if (allow404 && codes.includes(10003)) return NOT_FOUND;
      throw new StreamApiError(operation, {
        status: response.status,
        codes,
        retryable: response.status === 429 || response.status >= 500,
      });
    }
    return json?.result ?? null;
  }

  return {
    /**
     * Basic Direct Creator Upload (one-time URL, multipart POST, ≤ 200 MB).
     * https://developers.cloudflare.com/api/resources/stream/subresources/direct_upload/methods/create/
     * @param {{ maxDurationSeconds: number, expiry?: Date, requireSignedURLs?: boolean, creator?: string,
     *           meta?: Record<string, string>, thumbnailTimestampPct?: number }} params
     * @returns {Promise<{ uid: string, uploadURL: string }>}
     */
    async createDirectUpload({ maxDurationSeconds, expiry, requireSignedURLs, creator, meta, thumbnailTimestampPct }) {
      if (!Number.isInteger(maxDurationSeconds) || maxDurationSeconds < 1 || maxDurationSeconds > 36000) {
        throw new TypeError("maxDurationSeconds must be an integer between 1 and 36000.");
      }
      if (creator !== undefined && (typeof creator !== "string" || creator.length > 64)) {
        throw new TypeError("creator must be a string of at most 64 characters.");
      }
      const result = await call("direct upload", "/direct_upload", {
        method: "POST",
        body: {
          maxDurationSeconds,
          ...(expiry ? { expiry: expiry.toISOString() } : {}),
          ...(requireSignedURLs !== undefined ? { requireSignedURLs } : {}),
          ...(creator !== undefined ? { creator } : {}),
          ...(meta ? { meta } : {}),
          ...(thumbnailTimestampPct !== undefined ? { thumbnailTimestampPct } : {}),
        },
      });
      if (!result || typeof result.uid !== "string" || typeof result.uploadURL !== "string") {
        throw new StreamApiError("direct upload", { status: 200, retryable: false });
      }
      return { uid: assertStreamUid(result.uid), uploadURL: result.uploadURL };
    },

    /**
     * Video details, or null when Stream does not know the uid.
     * @param {string} uid
     */
    async getVideo(uid) {
      const result = await call("get video", `/${assertStreamUid(uid)}`, { allow404: true });
      return result === NOT_FOUND ? null : result;
    },

    /**
     * Updates editable video settings (we only ever use requireSignedURLs / thumbnailTimestampPct).
     * @param {string} uid
     * @param {{ requireSignedURLs?: boolean, thumbnailTimestampPct?: number }} settings
     */
    async updateVideo(uid, settings) {
      const body = {};
      if (settings.requireSignedURLs !== undefined) body.requireSignedURLs = settings.requireSignedURLs === true;
      if (settings.thumbnailTimestampPct !== undefined) body.thumbnailTimestampPct = settings.thumbnailTimestampPct;
      return call("update video", `/${assertStreamUid(uid)}`, { method: "POST", body });
    },

    /**
     * Deletes a video. Returns false when it was already gone (404 = done).
     * @param {string} uid
     */
    async deleteVideo(uid) {
      const result = await call("delete video", `/${assertStreamUid(uid)}`, { method: "DELETE", allow404: true });
      return result !== NOT_FOUND;
    },

    /**
     * @param {{ creator?: string, status?: string, before?: Date, after?: Date, limit?: number }} [filters]
     * @returns {Promise<any[]>}
     */
    async listVideos({ creator, status, before, after, limit } = {}) {
      const result = await call("list videos", "", {
        query: {
          creator,
          status,
          before: before?.toISOString(),
          after: after?.toISOString(),
          limit,
        },
      });
      return Array.isArray(result) ? result : [];
    },

    /**
     * Creates a signing key for self-signed playback tokens. The private key is returned only once.
     * https://developers.cloudflare.com/stream/viewing-videos/securing-your-stream/
     * @returns {Promise<{ id: string, jwk: string, pem: string }>}
     */
    createSigningKey() {
      return call("create signing key", "/keys", { method: "POST" });
    },
  };
}

/** @type {ReturnType<typeof createStreamClient> | undefined} */
let defaultClient;

/** Lazily-configured client from environment variables. */
export function getStreamClient() {
  if (!defaultClient) defaultClient = createStreamClient(readStreamConfig());
  return defaultClient;
}
