-- CreateEnum
CREATE TYPE "MeetingFileStatus" AS ENUM ('UPLOADING', 'PROCESSING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "MeetingFileKind" AS ENUM ('AUDIO', 'VIDEO', 'DOCUMENT', 'IMAGE');

-- CreateTable
CREATE TABLE "MeetingFile" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "kind" "MeetingFileKind" NOT NULL,
    "size" BIGINT NOT NULL,
    "status" "MeetingFileStatus" NOT NULL DEFAULT 'UPLOADING',
    "failureReason" TEXT,
    "storageKey" TEXT NOT NULL,
    "processingAttempt" INTEGER NOT NULL DEFAULT 0,
    "lastChunkAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MeetingFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MeetingFile_storageKey_key" ON "MeetingFile"("storageKey");

-- CreateIndex
CREATE INDEX "MeetingFile_meetingId_status_idx" ON "MeetingFile"("meetingId", "status");

-- CreateIndex
CREATE INDEX "MeetingFile_status_lastChunkAt_idx" ON "MeetingFile"("status", "lastChunkAt");

-- AddForeignKey
ALTER TABLE "MeetingFile" ADD CONSTRAINT "MeetingFile_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingFile" ADD CONSTRAINT "MeetingFile_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
