-- CreateEnum
CREATE TYPE "AnalysisStatus" AS ENUM ('RUNNING', 'FAILED');

-- AlterTable
ALTER TABLE "MeetingFile" ADD COLUMN     "analysisStatus" "AnalysisStatus";
