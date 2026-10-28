/** JWT audience of avatar links, so neither access tokens nor file links open an avatar. */
export const AVATAR_LINK_AUDIENCE = 'avatar-content';

/**
 * Avatar links are issued as of the start of the current window and live two windows, so every
 * profile load within a window gets the same URL (the browser keeps the image cached) and a link
 * stays valid one to two windows. Also the `max-age` of the image: a link is always valid that long.
 */
export const AVATAR_LINK_WINDOW_SECONDS = 60 * 60;

/** Lifetime of an avatar link counted from the start of its window. */
export const AVATAR_LINK_TTL_SECONDS = 2 * AVATAR_LINK_WINDOW_SECONDS;

/** Issue time (seconds since the epoch) of an avatar link signed at `nowMs`: its window start. */
export function avatarLinkIssuedAt(nowMs: number): number {
  const window = AVATAR_LINK_WINDOW_SECONDS;
  return Math.floor(nowMs / 1000 / window) * window;
}
