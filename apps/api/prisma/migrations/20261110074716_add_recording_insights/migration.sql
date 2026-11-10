-- CreateTable
CREATE TABLE "RecordingInsights" (
    "id" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecordingInsights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActionItem" (
    "id" TEXT NOT NULL,
    "insightsId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "assignee" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActionItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetingDecision" (
    "id" TEXT NOT NULL,
    "insightsId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MeetingDecision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RecordingInsights_fileId_key" ON "RecordingInsights"("fileId");

-- CreateIndex
CREATE INDEX "ActionItem_insightsId_idx" ON "ActionItem"("insightsId");

-- CreateIndex
CREATE UNIQUE INDEX "ActionItem_insightsId_position_key" ON "ActionItem"("insightsId", "position");

-- CreateIndex
CREATE INDEX "MeetingDecision_insightsId_idx" ON "MeetingDecision"("insightsId");

-- CreateIndex
CREATE UNIQUE INDEX "MeetingDecision_insightsId_position_key" ON "MeetingDecision"("insightsId", "position");

-- AddForeignKey
ALTER TABLE "RecordingInsights" ADD CONSTRAINT "RecordingInsights_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "MeetingFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionItem" ADD CONSTRAINT "ActionItem_insightsId_fkey" FOREIGN KEY ("insightsId") REFERENCES "RecordingInsights"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingDecision" ADD CONSTRAINT "MeetingDecision_insightsId_fkey" FOREIGN KEY ("insightsId") REFERENCES "RecordingInsights"("id") ON DELETE CASCADE ON UPDATE CASCADE;
