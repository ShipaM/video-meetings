import { API_URL } from './constants';

/** The signed-in user's profile from `GET /users/me`. */
export interface Profile {
  email: string;
  name: string | null;
  avatar: string | null;
}

/** The name to show for the user: the display name, or the e-mail when no name is set. */
export function getDisplayName(profile: Profile): string {
  return profile.name ?? profile.email;
}

/** Absolute URL of the user's avatar (the API answers a signed path), or `null` when none is set. */
export function getAvatarUrl(profile: Profile): string | null {
  return profile.avatar === null ? null : `${API_URL}${profile.avatar}`;
}
