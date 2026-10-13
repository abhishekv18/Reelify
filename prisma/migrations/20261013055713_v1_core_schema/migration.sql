-- CreateEnum
CREATE TYPE "VideoStatus" AS ENUM ('UPLOAD_PENDING', 'UPLOADED', 'PROCESSING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "VideoSource" AS ENUM ('UPLOAD', 'INSTAGRAM');

-- CreateEnum
CREATE TYPE "VideoErrorCode" AS ENUM ('INVALID_FILE', 'TOO_LONG', 'TOO_LARGE', 'TRANSCODE_ERROR', 'SOURCE_UNAVAILABLE', 'COPYRIGHT_RESTRICTED');

-- CreateEnum
CREATE TYPE "WidgetType" AS ENUM ('CAROUSEL', 'PRODUCT_VIDEOS', 'BUBBLE', 'STORIES');

-- CreateEnum
CREATE TYPE "PageType" AS ENUM ('HOME', 'ALL_PRODUCTS', 'PRODUCT', 'COLLECTION');

-- CreateEnum
CREATE TYPE "SocialPlatform" AS ENUM ('INSTAGRAM');

-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('IMPRESSION', 'VIEW', 'PRODUCT_CLICK', 'ADD_TO_CART');

-- CreateEnum
CREATE TYPE "WebhookStatus" AS ENUM ('PROCESSING', 'COMPLETED');

-- CreateTable
CREATE TABLE "Shop" (
    "id" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'free',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "onboarding" JSONB NOT NULL DEFAULT '{}',
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uninstalledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Video" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "status" "VideoStatus" NOT NULL DEFAULT 'UPLOAD_PENDING',
    "source" "VideoSource" NOT NULL DEFAULT 'UPLOAD',
    "externalId" TEXT,
    "title" TEXT,
    "caption" TEXT,
    "originalKey" TEXT,
    "videoKey" TEXT,
    "previewKey" TEXT,
    "posterKey" TEXT,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "durationMs" INTEGER,
    "errorCode" "VideoErrorCode",
    "errorMessage" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "rightsConfirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Video_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VideoProduct" (
    "shopId" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "productGid" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "VideoProduct_pkey" PRIMARY KEY ("videoId","productGid")
);

-- CreateTable
CREATE TABLE "Widget" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "WidgetType" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Widget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WidgetVideo" (
    "shopId" TEXT NOT NULL,
    "widgetId" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "WidgetVideo_pkey" PRIMARY KEY ("widgetId","videoId")
);

-- CreateTable
CREATE TABLE "Placement" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "widgetId" TEXT NOT NULL,
    "pageType" "PageType" NOT NULL,
    "targetGid" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Placement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialAccount" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "platform" "SocialPlatform" NOT NULL,
    "externalUserId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "profilePicUrl" TEXT,
    "accessTokenEnc" TEXT NOT NULL,
    "keyVersion" INTEGER NOT NULL,
    "tokenIssuedAt" TIMESTAMP(3) NOT NULL,
    "tokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "needsReconnect" BOOLEAN NOT NULL DEFAULT false,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OAuthState" (
    "id" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OAuthState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" BIGSERIAL NOT NULL,
    "shopId" TEXT NOT NULL,
    "type" "EventType" NOT NULL,
    "videoId" TEXT,
    "widgetId" TEXT,
    "productGid" TEXT,
    "sessionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessedWebhook" (
    "id" TEXT NOT NULL,
    "webhookId" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "status" "WebhookStatus" NOT NULL DEFAULT 'PROCESSING',
    "claimToken" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "ProcessedWebhook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimit" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "windowStart" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Shop_shopDomain_key" ON "Shop"("shopDomain");

-- CreateIndex
CREATE INDEX "Video_shopId_status_createdAt_idx" ON "Video"("shopId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Video_shopId_id_key" ON "Video"("shopId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Video_shopId_source_externalId_key" ON "Video"("shopId", "source", "externalId");

-- CreateIndex
CREATE INDEX "VideoProduct_shopId_productGid_idx" ON "VideoProduct"("shopId", "productGid");

-- CreateIndex
CREATE INDEX "VideoProduct_shopId_videoId_idx" ON "VideoProduct"("shopId", "videoId");

-- CreateIndex
CREATE INDEX "Widget_shopId_createdAt_idx" ON "Widget"("shopId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Widget_shopId_id_key" ON "Widget"("shopId", "id");

-- CreateIndex
CREATE INDEX "WidgetVideo_shopId_widgetId_idx" ON "WidgetVideo"("shopId", "widgetId");

-- CreateIndex
CREATE INDEX "WidgetVideo_shopId_videoId_idx" ON "WidgetVideo"("shopId", "videoId");

-- CreateIndex
CREATE INDEX "Placement_shopId_pageType_idx" ON "Placement"("shopId", "pageType");

-- CreateIndex
CREATE INDEX "Placement_shopId_widgetId_idx" ON "Placement"("shopId", "widgetId");

-- CreateIndex
CREATE UNIQUE INDEX "SocialAccount_shopId_platform_key" ON "SocialAccount"("shopId", "platform");

-- CreateIndex
CREATE UNIQUE INDEX "OAuthState_nonce_key" ON "OAuthState"("nonce");

-- CreateIndex
CREATE INDEX "OAuthState_shopId_idx" ON "OAuthState"("shopId");

-- CreateIndex
CREATE INDEX "OAuthState_expiresAt_idx" ON "OAuthState"("expiresAt");

-- CreateIndex
CREATE INDEX "Event_shopId_createdAt_idx" ON "Event"("shopId", "createdAt");

-- CreateIndex
CREATE INDEX "Event_shopId_type_createdAt_idx" ON "Event"("shopId", "type", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessedWebhook_webhookId_key" ON "ProcessedWebhook"("webhookId");

-- CreateIndex
CREATE INDEX "ProcessedWebhook_processedAt_idx" ON "ProcessedWebhook"("processedAt");

-- CreateIndex
CREATE UNIQUE INDEX "RateLimit_key_key" ON "RateLimit"("key");

-- CreateIndex
CREATE INDEX "RateLimit_windowStart_idx" ON "RateLimit"("windowStart");

-- AddForeignKey
ALTER TABLE "Video" ADD CONSTRAINT "Video_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoProduct" ADD CONSTRAINT "VideoProduct_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoProduct" ADD CONSTRAINT "VideoProduct_shopId_videoId_fkey" FOREIGN KEY ("shopId", "videoId") REFERENCES "Video"("shopId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Widget" ADD CONSTRAINT "Widget_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WidgetVideo" ADD CONSTRAINT "WidgetVideo_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WidgetVideo" ADD CONSTRAINT "WidgetVideo_shopId_widgetId_fkey" FOREIGN KEY ("shopId", "widgetId") REFERENCES "Widget"("shopId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WidgetVideo" ADD CONSTRAINT "WidgetVideo_shopId_videoId_fkey" FOREIGN KEY ("shopId", "videoId") REFERENCES "Video"("shopId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Placement" ADD CONSTRAINT "Placement_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Placement" ADD CONSTRAINT "Placement_shopId_widgetId_fkey" FOREIGN KEY ("shopId", "widgetId") REFERENCES "Widget"("shopId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialAccount" ADD CONSTRAINT "SocialAccount_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OAuthState" ADD CONSTRAINT "OAuthState_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
