import { CreateUserHandler } from './handlers/create-user.handler.js';
import { UpdateProfileHandler } from './handlers/update-profile.handler.js';

export { CreateUserCommand } from './create-user.command.js';
export { UpdateProfileCommand } from './update-profile.command.js';

export const CommandHandlers = [CreateUserHandler, UpdateProfileHandler];
