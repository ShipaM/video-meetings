import { AuthorizeAvatarUploadRequestHandler } from './handlers/authorize-avatar-upload-request.handler.js';
import { CancelAvatarUploadHandler } from './handlers/cancel-avatar-upload.handler.js';
import { CompleteAvatarUploadHandler } from './handlers/complete-avatar-upload.handler.js';
import { CreateAvatarUploadHandler } from './handlers/create-avatar-upload.handler.js';
import { CreateUserHandler } from './handlers/create-user.handler.js';
import { UpdatePasswordHashHandler } from './handlers/update-password-hash.handler.js';
import { UpdateProfileHandler } from './handlers/update-profile.handler.js';

export { AuthorizeAvatarUploadRequestCommand } from './authorize-avatar-upload-request.command.js';
export { CancelAvatarUploadCommand } from './cancel-avatar-upload.command.js';
export { CleanupAvatarUploadsCommand } from './cleanup-avatar-uploads.command.js';
export { CompleteAvatarUploadCommand } from './complete-avatar-upload.command.js';
export { CreateAvatarUploadCommand } from './create-avatar-upload.command.js';
export { CreateUserCommand } from './create-user.command.js';
export { UpdatePasswordHashCommand } from './update-password-hash.command.js';
export { UpdateProfileCommand } from './update-profile.command.js';

export const CommandHandlers = [
  CreateUserHandler,
  UpdatePasswordHashHandler,
  UpdateProfileHandler,
  CreateAvatarUploadHandler,
  CompleteAvatarUploadHandler,
  CancelAvatarUploadHandler,
  AuthorizeAvatarUploadRequestHandler,
];
