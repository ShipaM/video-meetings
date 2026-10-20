-- AlterTable
ALTER TABLE "MeetingFile" ADD COLUMN     "durationMs" INTEGER;

-- CreateTable
CREATE TABLE "TranscriptSegment" (
    "fileId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "startMs" INTEGER NOT NULL,
    "endMs" INTEGER NOT NULL,
    "text" TEXT NOT NULL,

    CONSTRAINT "TranscriptSegment_pkey" PRIMARY KEY ("fileId","position")
);

-- AddForeignKey
ALTER TABLE "TranscriptSegment" ADD CONSTRAINT "TranscriptSegment_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "MeetingFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
