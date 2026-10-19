import { AddParticipantHandler } from './handlers/add-participant.handler.js';
import { CreateMeetingHandler } from './handlers/create-meeting.handler.js';
import { RemoveParticipantHandler } from './handlers/remove-participant.handler.js';

export { AddParticipantCommand } from './add-participant.command.js';
export { CreateMeetingCommand } from './create-meeting.command.js';
export { RemoveParticipantCommand } from './remove-participant.command.js';

export const CommandHandlers = [
  CreateMeetingHandler,
  AddParticipantHandler,
  RemoveParticipantHandler,
];
