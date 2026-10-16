-- D10 (2026-10-13): media moved from Cloudflare R2 to Cloudflare Stream.
-- Drops the four unused R2 key columns and adds Stream fields.
-- Safety guard: abort (nothing is changed) if any R2 column still holds data in this database.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "Video"
    WHERE "originalKey" IS NOT NULL OR "videoKey" IS NOT NULL
       OR "previewKey" IS NOT NULL OR "posterKey" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'stream_video_fields: Video R2 key columns contain data; refusing to drop them';
  END IF;
END $$;

-- AlterTable
ALTER TABLE "Video" DROP COLUMN "originalKey",
DROP COLUMN "posterKey",
DROP COLUMN "previewKey",
DROP COLUMN "videoKey",
ADD COLUMN     "streamState" TEXT,
ADD COLUMN     "streamSyncedAt" TIMESTAMP(3),
ADD COLUMN     "streamUid" TEXT,
ADD COLUMN     "uploadExpiresAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Video_status_updatedAt_idx" ON "Video"("status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Video_streamUid_key" ON "Video"("streamUid");

