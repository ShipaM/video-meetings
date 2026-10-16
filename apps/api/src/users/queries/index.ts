import { FindUserByEmailHandler } from './handlers/find-user-by-email.handler.js';
import { FindUserByIdHandler } from './handlers/find-user-by-id.handler.js';

export { FindUserByEmailQuery } from './find-user-by-email.query.js';
export { FindUserByIdQuery } from './find-user-by-id.query.js';

export const QueryHandlers = [FindUserByEmailHandler, FindUserByIdHandler];
