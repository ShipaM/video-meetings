-- Recordings uploaded before transcription existed became READY without a transcript or a
-- summary. Mark them FAILED with a reason, so the owner can start their transcription with Retry.
UPDATE "MeetingFile" AS f
SET "status" = 'FAILED',
    "failureReason" = 'Uploaded before recordings were transcribed; retry to transcribe it',
    "updatedAt" = NOW()
WHERE f."kind" IN ('AUDIO', 'VIDEO')
  AND f."status" = 'READY'
  AND NOT EXISTS (SELECT 1 FROM "MeetingFileSummary" s WHERE s."fileId" = f."id");
