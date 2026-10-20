import { AuthorizeUploadRequestHandler } from './handlers/authorize-upload-request.handler.js';
import { CancelUploadHandler } from './handlers/cancel-upload.handler.js';
import { CleanupAbandonedUploadsHandler } from './handlers/cleanup-abandoned-uploads.handler.js';
import { CompleteUploadHandler } from './handlers/complete-upload.handler.js';
import { CreateUploadHandler } from './handlers/create-upload.handler.js';
import { DeleteMeetingFileHandler } from './handlers/delete-meeting-file.handler.js';
import { FailStuckProcessingHandler } from './handlers/fail-stuck-processing.handler.js';
import { ProcessDocumentHandler } from './handlers/process-document.handler.js';
import { ProcessRecordingHandler } from './handlers/process-recording.handler.js';
import { RetryFileProcessingHandler } from './handlers/retry-file-processing.handler.js';
import { SweepOrphanFilesHandler } from './handlers/sweep-orphan-files.handler.js';

export { AuthorizeUploadRequestCommand } from './authorize-upload-request.command.js';
export { CancelUploadCommand } from './cancel-upload.command.js';
export { CleanupAbandonedUploadsCommand } from './cleanup-abandoned-uploads.command.js';
export { CompleteUploadCommand } from './complete-upload.command.js';
export { CreateUploadCommand } from './create-upload.command.js';
export { DeleteMeetingFileCommand } from './delete-meeting-file.command.js';
export { FailStuckProcessingCommand } from './fail-stuck-processing.command.js';
export { ProcessDocumentCommand } from './process-document.command.js';
export { ProcessRecordingCommand } from './process-recording.command.js';
export { RetryFileProcessingCommand } from './retry-file-processing.command.js';
export { SweepOrphanFilesCommand } from './sweep-orphan-files.command.js';

export const CommandHandlers = [
  CreateUploadHandler,
  AuthorizeUploadRequestHandler,
  CompleteUploadHandler,
  CancelUploadHandler,
  CleanupAbandonedUploadsHandler,
  DeleteMeetingFileHandler,
  SweepOrphanFilesHandler,
  ProcessDocumentHandler,
  ProcessRecordingHandler,
  RetryFileProcessingHandler,
  FailStuckProcessingHandler,
];
