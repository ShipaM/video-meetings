-- CreateTable
CREATE TABLE "MeetingFileSummary" (
    "fileId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MeetingFileSummary_pkey" PRIMARY KEY ("fileId")
);

-- AddForeignKey
ALTER TABLE "MeetingFileSummary" ADD CONSTRAINT "MeetingFileSummary_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "MeetingFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
