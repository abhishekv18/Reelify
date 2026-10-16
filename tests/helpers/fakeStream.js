/**
 * In-memory Cloudflare Stream client for tests. Same method surface as createStreamClient().
 * Shapes follow the documented API responses (tests/fixtures/stream/*.json).
 */
import { randomBytes } from "node:crypto";
import { StreamApiError } from "../../app/services/stream.server.js";

export function newUid() {
  return randomBytes(16).toString("hex");
}

/**
 * Builds a Stream video details object.
 * @param {{ uid: string, creator: string, videoId: string, state?: string, readyToStream?: boolean,
 *           errorReasonCode?: string, duration?: number, size?: number, width?: number, height?: number,
 *           requireSignedURLs?: boolean }} o
 */
export function streamVideo(o) {
  return {
    uid: o.uid,
    creator: o.creator,
    meta: { app: "reelify", shopId: o.creator, videoId: o.videoId },
    readyToStream: o.readyToStream ?? o.state === "ready",
    requireSignedURLs: o.requireSignedURLs ?? true,
    status: { state: o.state ?? "pendingupload", errorReasonCode: o.errorReasonCode ?? "" },
    duration: o.duration ?? -1,
    size: o.size ?? 0,
    input: { width: o.width ?? -1, height: o.height ?? -1 },
  };
}

export function createFakeStream() {
  /** @type {Map<string, any>} */
  const videos = new Map();
  const calls = { createDirectUpload: [], getVideo: [], updateVideo: [], deleteVideo: [] };
  let failNext = null;

  const maybeFail = (operation) => {
    if (failNext) {
      const err = failNext;
      failNext = null;
      throw new StreamApiError(operation, err);
    }
  };

  return {
    videos,
    calls,
    /** Make the next API call fail with { status, retryable }. */
    failNextCall(info = { status: 500, retryable: true }) {
      failNext = info;
    },
    /** Simulate Stream-side progress for a uid. */
    setState(uid, patch) {
      const current = videos.get(uid);
      const next = { ...current, ...patch, status: { ...current.status, ...(patch.status ?? {}) } };
      if (patch.state) next.status.state = patch.state;
      if (patch.state === "ready" && patch.readyToStream === undefined) next.readyToStream = true;
      if (patch.errorReasonCode) next.status.errorReasonCode = patch.errorReasonCode;
      videos.set(uid, next);
    },
    async createDirectUpload(params) {
      calls.createDirectUpload.push(params);
      maybeFail("direct upload");
      const uid = newUid();
      videos.set(uid, streamVideo({ uid, creator: params.creator, videoId: params.meta?.videoId }));
      videos.get(uid).meta = { ...params.meta };
      videos.get(uid).requireSignedURLs = params.requireSignedURLs;
      return { uid, uploadURL: `https://upload.example.test/one-time/${uid}` };
    },
    async getVideo(uid) {
      calls.getVideo.push(uid);
      maybeFail("get video");
      return videos.has(uid) ? structuredClone(videos.get(uid)) : null;
    },
    async updateVideo(uid, settings) {
      calls.updateVideo.push({ uid, settings });
      maybeFail("update video");
      if (videos.has(uid)) videos.set(uid, { ...videos.get(uid), ...settings });
      return videos.get(uid) ?? null;
    },
    async deleteVideo(uid) {
      calls.deleteVideo.push(uid);
      maybeFail("delete video");
      return videos.delete(uid);
    },
    async listVideos() {
      return [...videos.values()];
    },
  };
}
