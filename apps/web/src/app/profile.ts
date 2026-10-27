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
