import { FindUserByEmailHandler } from './handlers/find-user-by-email.handler.js';
import { FindUserByIdHandler } from './handlers/find-user-by-id.handler.js';
import { FindUsersByIdsHandler } from './handlers/find-users-by-ids.handler.js';

export { FindUserByEmailQuery } from './find-user-by-email.query.js';
export { FindUserByIdQuery } from './find-user-by-id.query.js';
export { FindUsersByIdsQuery } from './find-users-by-ids.query.js';

export const QueryHandlers = [FindUserByEmailHandler, FindUserByIdHandler, FindUsersByIdsHandler];
