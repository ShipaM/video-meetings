import { ChangePasswordHandler } from './handlers/change-password.handler.js';
import { RegisterUserHandler } from './handlers/register-user.handler.js';

export { ChangePasswordCommand } from './change-password.command.js';
export { RegisterUserCommand } from './register-user.command.js';

export const CommandHandlers = [ChangePasswordHandler, RegisterUserHandler];
