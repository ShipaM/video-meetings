import { GetMeetingHandler } from './handlers/get-meeting.handler.js';
import { ListMeetingsHandler } from './handlers/list-meetings.handler.js';

export { GetMeetingQuery } from './get-meeting.query.js';
export { ListMeetingsQuery } from './list-meetings.query.js';

export const QueryHandlers = [ListMeetingsHandler, GetMeetingHandler];
