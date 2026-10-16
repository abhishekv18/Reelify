import { describe, expect, it } from "vitest";
import { allowedFrom, canTransition, mapStreamVideo } from "../../app/lib/streamStatus.js";

const details = (state, extra = {}) => ({ readyToStream: false, status: { state, ...extra.status }, ...extra });

describe("mapStreamVideo", () => {
  it.each([
    ["pendingupload", "UPLOAD_PENDING"],
    ["downloading", "UPLOADED"],
    ["queued", "UPLOADED"],
    ["inprogress", "PROCESSING"],
    ["live-inprogress", "PROCESSING"],
    ["something-new", "PROCESSING"],
  ])("%s → %s", (state, status) => {
    expect(mapStreamVideo(details(state)).status).toBe(status);
  });

  it("is READY only when state is ready and readyToStream is true", () => {
    expect(mapStreamVideo({ readyToStream: true, status: { state: "ready" } }).status).toBe("READY");
    expect(mapStreamVideo({ readyToStream: false, status: { state: "ready" } }).status).toBe("PROCESSING");
  });

  it.each([
    ["ERR_NON_VIDEO", "INVALID_FILE"],
    ["ERR_MALFORMED_VIDEO", "INVALID_FILE"],
    ["ERR_DURATION_TOO_SHORT", "INVALID_FILE"],
    ["ERR_DURATION_EXCEED_CONSTRAINT", "TOO_LONG"],
    ["ERR_FETCH_ORIGIN_ERROR", "SOURCE_UNAVAILABLE"],
    ["ERR_UNKNOWN", "TRANSCODE_ERROR"],
    ["ERR_SOMETHING_NEW", "TRANSCODE_ERROR"],
  ])("error %s → FAILED %s with a message", (reason, code) => {
    const mapped = mapStreamVideo({ status: { state: "error", errorReasonCode: reason } });
    expect(mapped).toMatchObject({ status: "FAILED", errorCode: code });
    expect(mapped.errorMessage).toMatch(/\w/);
  });

  it("accepts the alternative errReasonCode field used in Cloudflare's example", () => {
    expect(mapStreamVideo({ status: { state: "error", errReasonCode: "ERR_NON_VIDEO" } }).errorCode).toBe("INVALID_FILE");
  });
});

describe("forward-only transitions", () => {
  it("never moves backwards", () => {
    expect(canTransition("PROCESSING", "UPLOADED")).toBe(false);
    expect(canTransition("UPLOADED", "UPLOAD_PENDING")).toBe(false);
    expect(canTransition("UPLOAD_PENDING", "PROCESSING")).toBe(true);
    expect(canTransition("UPLOAD_PENDING", "READY")).toBe(true);
  });

  it("treats READY and FAILED as terminal", () => {
    for (const to of ["UPLOAD_PENDING", "UPLOADED", "PROCESSING", "READY", "FAILED"]) {
      expect(canTransition("READY", to)).toBe(false);
      expect(canTransition("FAILED", to)).toBe(false);
    }
  });

  it("allows same-status refresh only for non-terminal statuses", () => {
    expect(canTransition("PROCESSING", "PROCESSING")).toBe(true);
    expect(allowedFrom("READY")).toEqual(["UPLOAD_PENDING", "UPLOADED", "PROCESSING"]);
    expect(allowedFrom("UPLOAD_PENDING")).toEqual(["UPLOAD_PENDING"]);
  });
});
