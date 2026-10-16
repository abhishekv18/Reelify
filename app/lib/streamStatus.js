/**
 * Cloudflare Stream state → Reelify video status (CLAUDE.md §7). Pure; shared by sync code and tests.
 * Stream states (list API enum): pendingupload, downloading, queued, inprogress, ready, error, live-inprogress.
 */

/** Forward-only ordering. READY and FAILED are terminal. */
const RANK = Object.freeze({ UPLOAD_PENDING: 0, UPLOADED: 1, PROCESSING: 2, READY: 3, FAILED: 3 });
export const TERMINAL_STATUSES = Object.freeze(["READY", "FAILED"]);
export const ALL_STATUSES = Object.freeze(Object.keys(RANK));

/** Stream error reason codes (webhook docs) → our VideoErrorCode. Unknown codes → TRANSCODE_ERROR. */
export const STREAM_ERROR_CODES = Object.freeze({
  ERR_NON_VIDEO: "INVALID_FILE",
  ERR_MALFORMED_VIDEO: "INVALID_FILE",
  ERR_DURATION_TOO_SHORT: "INVALID_FILE",
  ERR_DURATION_EXCEED_CONSTRAINT: "TOO_LONG",
  ERR_FETCH_ORIGIN_ERROR: "SOURCE_UNAVAILABLE",
  ERR_UNKNOWN: "TRANSCODE_ERROR",
});

/** Plain-language messages stored in Video.errorMessage. */
export const ERROR_MESSAGES = Object.freeze({
  INVALID_FILE: "This file isn't a playable video. Check the file and upload it again.",
  TOO_LONG: "Videos can be up to 3 minutes long. Trim the video and upload it again.",
  TOO_LARGE: "Videos can be up to 200 MB. Compress the video and upload it again.",
  TRANSCODE_ERROR: "We couldn't process this video. Upload it again.",
  SOURCE_UNAVAILABLE: "The video file is no longer available. Upload or import it again.",
  COPYRIGHT_RESTRICTED: "This video can't be imported because of licensed content. Upload the file instead.",
});

/**
 * Maps a Stream video details object to our status (and error, for FAILED).
 * @param {{ readyToStream?: boolean, status?: { state?: string, errorReasonCode?: string, errReasonCode?: string } }} details
 * @returns {{ status: string, errorCode?: string, errorMessage?: string }}
 */
export function mapStreamVideo(details) {
  const state = details?.status?.state;
  switch (state) {
    case "pendingupload":
      return { status: "UPLOAD_PENDING" };
    case "downloading":
    case "queued":
      return { status: "UPLOADED" };
    case "inprogress":
      return { status: "PROCESSING" };
    case "ready":
      // Playable only when readyToStream is true as well (webhook docs).
      return details.readyToStream === true ? { status: "READY" } : { status: "PROCESSING" };
    case "error": {
      // The docs use both errorReasonCode and errReasonCode in examples.
      const reason = details.status.errorReasonCode ?? details.status.errReasonCode;
      const errorCode = STREAM_ERROR_CODES[reason] ?? "TRANSCODE_ERROR";
      return { status: "FAILED", errorCode, errorMessage: ERROR_MESSAGES[errorCode] };
    }
    default:
      // Unknown/unexpected state (e.g. live-inprogress): treat as still processing, never as READY.
      return { status: "PROCESSING" };
  }
}

/**
 * Statuses a video may move FROM to reach `target`. Same-status updates are allowed for non-terminal
 * statuses (metadata refresh); terminal statuses never change.
 * @param {string} target
 * @returns {string[]}
 */
export function allowedFrom(target) {
  if (!(target in RANK)) throw new Error(`Unknown status: ${target}`);
  return ALL_STATUSES.filter((from) => {
    if (TERMINAL_STATUSES.includes(from)) return false;
    return RANK[from] < RANK[target] || (from === target && !TERMINAL_STATUSES.includes(target));
  });
}

/**
 * @param {string} from
 * @param {string} to
 */
export function canTransition(from, to) {
  return allowedFrom(to).includes(from);
}
