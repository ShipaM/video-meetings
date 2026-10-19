import type { Meeting } from '../generated/prisma/client.js';

/** The caller's relation to a meeting: its owner, or a participant it was shared with. */
export type MeetingRole = 'owner' | 'participant';

/**
 * What the caller wants to do with a meeting: `view` is allowed to the owner and participants,
 * `manage` (uploads, deletion, participants) to the owner only.
 */
export type MeetingAccess = 'view' | 'manage';

/** A meeting as returned by the API, with the caller's role in it. */
export interface MeetingView {
  id: string;
  title: string;
  startsAt: Date;
  ownerId: string;
  role: MeetingRole;
  createdAt: Date;
  updatedAt: Date;
}

export const toMeetingView = (meeting: Meeting, userId: string): MeetingView => ({
  id: meeting.id,
  title: meeting.title,
  startsAt: meeting.startsAt,
  ownerId: meeting.ownerId,
  role: meeting.ownerId === userId ? 'owner' : 'participant',
  createdAt: meeting.createdAt,
  updatedAt: meeting.updatedAt,
});

/** A participant of a meeting as returned by the API. */
export interface ParticipantView {
  userId: string;
  email: string;
  addedAt: Date;
}

/** Prisma filter: meetings the user owns or was added to as a participant. */
export const visibleTo = (userId: string) => ({
  OR: [{ ownerId: userId }, { participants: { some: { userId } } }],
});
