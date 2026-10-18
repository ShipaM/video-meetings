import { AuthorizeUploadRequestHandler } from './handlers/authorize-upload-request.handler.js';
import { CompleteUploadHandler } from './handlers/complete-upload.handler.js';
import { CreateUploadHandler } from './handlers/create-upload.handler.js';

export { AuthorizeUploadRequestCommand } from './authorize-upload-request.command.js';
export { CompleteUploadCommand } from './complete-upload.command.js';
export { CreateUploadCommand } from './create-upload.command.js';

export const CommandHandlers = [
  CreateUploadHandler,
  AuthorizeUploadRequestHandler,
  CompleteUploadHandler,
];
