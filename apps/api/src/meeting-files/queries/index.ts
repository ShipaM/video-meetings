import { GetFileContentHandler } from './handlers/get-file-content.handler.js';
import { GetFileLinkHandler } from './handlers/get-file-link.handler.js';
import { ListMeetingFilesHandler } from './handlers/list-meeting-files.handler.js';

export { GetFileContentQuery } from './get-file-content.query.js';
export { GetFileLinkQuery } from './get-file-link.query.js';
export { ListMeetingFilesQuery } from './list-meeting-files.query.js';

export const QueryHandlers = [ListMeetingFilesHandler, GetFileLinkHandler, GetFileContentHandler];
