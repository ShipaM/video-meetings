-- CreateEnum
CREATE TYPE "RecordingStage" AS ENUM ('QUEUED', 'PREPARING_AUDIO', 'TRANSCRIBING', 'SUMMARIZING');

-- AlterTable
ALTER TABLE "MeetingFile" ADD COLUMN     "processingStage" "RecordingStage" NOT NULL DEFAULT 'QUEUED';
