-- CreateTable
CREATE TABLE "MeetingParticipant" (
    "meetingId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MeetingParticipant_pkey" PRIMARY KEY ("meetingId","userId")
);

-- CreateIndex
CREATE INDEX "MeetingParticipant_userId_idx" ON "MeetingParticipant"("userId");

-- AddForeignKey
ALTER TABLE "MeetingParticipant" ADD CONSTRAINT "MeetingParticipant_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingParticipant" ADD CONSTRAINT "MeetingParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
