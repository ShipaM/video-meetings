/** A stored user. Includes `passwordHash`, so it is for internal (CQRS) use only, never for HTTP responses. */
export interface UserRecord {
  id: string;
  email: string;
  passwordHash: string;
}

/** The public part of a user (no password hash), for showing users to other users. */
export type UserContact = Pick<UserRecord, 'id' | 'email'>;

/** The signed-in user's own profile, safe for HTTP responses. `avatar` stays `null` until avatars exist. */
export interface UserProfile {
  email: string;
  name: string | null;
  avatar: null;
}
