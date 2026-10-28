import { FindAvatarStorageKeysHandler } from './handlers/find-avatar-storage-keys.handler.js';
import { FindUserByEmailHandler } from './handlers/find-user-by-email.handler.js';
import { FindUserByIdHandler } from './handlers/find-user-by-id.handler.js';
import { FindUsersByIdsHandler } from './handlers/find-users-by-ids.handler.js';
import { GetAvatarContentHandler } from './handlers/get-avatar-content.handler.js';
import { GetProfileHandler } from './handlers/get-profile.handler.js';

export { FindAvatarStorageKeysQuery } from './find-avatar-storage-keys.query.js';
export { FindUserByEmailQuery } from './find-user-by-email.query.js';
export { FindUserByIdQuery } from './find-user-by-id.query.js';
export { FindUsersByIdsQuery } from './find-users-by-ids.query.js';
export { GetAvatarContentQuery } from './get-avatar-content.query.js';
export { GetProfileQuery } from './get-profile.query.js';

export const QueryHandlers = [
  FindAvatarStorageKeysHandler,
  FindUserByEmailHandler,
  FindUserByIdHandler,
  FindUsersByIdsHandler,
  GetAvatarContentHandler,
  GetProfileHandler,
];
