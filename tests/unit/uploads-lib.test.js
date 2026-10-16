import { describe, expect, it } from "vitest";
import {
  MAX_DURATION_SECONDS,
  MAX_UPLOAD_BYTES,
  titleFromFilename,
  validateUploadRequest,
} from "../../app/lib/uploads.js";

const valid = { filename: "summer drop.mp4", contentType: "video/mp4", sizeBytes: 1_000_000, rightsConfirmed: true };

describe("upload limits (D9)", () => {
  it("uses exactly 200,000,000 bytes and 180 seconds", () => {
    expect(MAX_UPLOAD_BYTES).toBe(200_000_000);
    expect(MAX_DURATION_SECONDS).toBe(180);
  });
});

describe("validateUploadRequest", () => {
  it("accepts MP4, MOV and WebM", () => {
    for (const contentType of ["video/mp4", "video/quicktime", "video/webm"]) {
      expect(validateUploadRequest({ ...valid, contentType }).ok).toBe(true);
    }
  });

  it.each([
    ["image/png"],
    ["text/plain"],
    ["video/x-msvideo"],
    ["video/MP4"],
    [""],
    [undefined],
  ])("rejects content type %s", (contentType) => {
    expect(validateUploadRequest({ ...valid, contentType })).toMatchObject({ ok: false, code: "UNSUPPORTED_TYPE" });
  });

  it.each([[0], [-1], [1.5], ["100"], [Number.MAX_SAFE_INTEGER + 1], [undefined]])(
    "rejects invalid size %s",
    (sizeBytes) => {
      expect(validateUploadRequest({ ...valid, sizeBytes }).ok).toBe(false);
    },
  );

  it("accepts the exact limit and rejects one byte more", () => {
    expect(validateUploadRequest({ ...valid, sizeBytes: 200_000_000 }).ok).toBe(true);
    expect(validateUploadRequest({ ...valid, sizeBytes: 200_000_001 })).toMatchObject({ ok: false, code: "TOO_LARGE" });
  });

  it.each([[false], ["true"], [1], [undefined]])("requires rightsConfirmed === true (got %s)", (rightsConfirmed) => {
    expect(validateUploadRequest({ ...valid, rightsConfirmed })).toMatchObject({
      ok: false,
      code: "RIGHTS_NOT_CONFIRMED",
    });
  });

  it("rejects non-object bodies and bad filenames", () => {
    expect(validateUploadRequest(null).ok).toBe(false);
    expect(validateUploadRequest([valid]).ok).toBe(false);
    expect(validateUploadRequest({ ...valid, filename: "" }).ok).toBe(false);
    expect(validateUploadRequest({ ...valid, filename: "x".repeat(256) }).ok).toBe(false);
  });

  it("ignores client-supplied shop ids, uids and destinations", () => {
    const result = validateUploadRequest({
      ...valid,
      shopId: "other-shop",
      streamUid: "abc",
      uploadURL: "https://evil.example",
    });
    expect(result.ok).toBe(true);
    expect(Object.keys(result.value).sort()).toEqual(["contentType", "filename", "sizeBytes", "title"]);
  });
});

describe("titleFromFilename", () => {
  it("drops the extension, path and control characters", () => {
    expect(titleFromFilename("C:\\videos\\my_summer\u0007clip.MOV")).toBe("my summer clip");
    expect(titleFromFilename(".mp4")).toBe("Untitled video");
    expect(titleFromFilename("a".repeat(300) + ".mp4")).toHaveLength(120);
  });
});
