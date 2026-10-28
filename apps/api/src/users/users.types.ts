/** A stored user. Includes `passwordHash`, so it is for internal (CQRS) use only, never for HTTP responses. */
export interface UserRecord {
  id: string;
  email: string;
  passwordHash: string;
}

/** The public part of a user (no password hash), for showing users to other users. */
export type UserContact = Pick<UserRecord, 'id' | 'email'>;

/**
 * The signed-in user's own profile, safe for HTTP responses. `avatar` is the signed content URL of
 * the current avatar (relative to the API), `null` when none is set.
 */
export interface UserProfile {
  email: string;
  name: string | null;
  avatar: string | null;
}

/** Payload of an avatar link token. */
export interface AvatarLinkPayload {
  sub: string;
  avatarId: string;
}

/** What the avatar content route needs to stream the image. */
export interface AvatarContent {
  path: string;
  mimeType: string;
}
