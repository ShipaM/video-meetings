# PRD: User profile

**Date**: 2026-10-25
**Status**: Draft

## Goal

Let a signed-in user personalize their account: set a display name and an avatar, change their password, and see
this information on a profile page. The avatar and name also appear next to the user in the header of the home
page, so the app feels like their own account rather than an e-mail address.

## User scenarios

- The user opens the profile page (`/profile`) from the home page header -> sees their avatar (or a placeholder when
  none is set), their name (or their e-mail when no name is set) and their e-mail.
- The user presses "Edit" on the profile page -> lands on the Profile Edit page (`/profile/edit`) with the current
  name and avatar filled in.
- The user changes the name and saves -> returns to the profile page and sees the new name; the home page header
  shows it too.
- The user clears the name and saves -> the profile page and the header show the e-mail instead.
- The user enters a name longer than 50 characters (after trimming) -> gets a validation error, nothing is saved.
- The user selects a new avatar (PNG, JPEG or WebP, up to 5 MB) and saves -> sees upload progress, then the new
  avatar on the profile page and in the home page header.
- The user selects a file of another type or larger than 5 MB -> the file is rejected before the upload starts, with
  a message naming the reason.
- The user uploads a file whose content is not the image type it claims to be -> gets an error, the avatar stays as
  it was.
- The user removes their avatar and saves -> the profile page and the header show the placeholder.
- The user changes the password by entering the old password and a new one -> gets a confirmation and stays signed
  in; the next login works with the new password only.
- The user enters a wrong old password -> gets an error, the password does not change.
- The user enters a new password shorter than 8 characters -> gets a validation error, the password does not change.
- A user who is not signed in opens `/profile` or `/profile/edit` -> is redirected to `/login`.

## In scope

- User data: an optional display name (1-50 characters after trimming; empty means "not set") and an optional
  avatar.
- API (all routes require a signed-in user and act on that user only):
  - `GET` profile: e-mail, name and the avatar (or its absence), enough for the web app to show it.
  - `PATCH` profile: change the name and/or set or remove the avatar.
  - `POST` change password: takes the old and the new password; a wrong old password is an error.
- Avatar upload through the existing resumable upload mechanism (tus `/uploads`), extended with an avatar upload that
  is not tied to a meeting:
  - allowed types PNG, JPEG, WebP, up to 5 MB, checked by declared type and by file content;
  - stored in the existing file storage, never served statically;
  - a replaced or removed avatar, and an avatar upload that is never attached to the profile, leave no file behind.
- Web pages:
  - Profile (`/profile`): avatar, name or e-mail, e-mail, "Edit" and "Change password" actions.
  - Profile Edit (`/profile/edit`): name field, avatar picker with preview and upload progress, remove avatar, save
    and cancel; a change-password form with old password, new password and confirmation.
- Home page header: the user's avatar (or placeholder) and name (or e-mail), linking to `/profile`.
- e2e tests for every new or changed endpoint, including the avatar upload.

## Out of scope

- Changing the e-mail.
- Deleting the account.
- A public profile page or showing other users' avatars and names (e.g. in meeting participant lists).
- OAuth / social login.
- Cropping, resizing or framing the image (the avatar is shown cut to a circle as uploaded).
- Signing out other sessions after a password change, password reset by e-mail.

## Technical constraints

- `UsersModule` owns the `User` table and is reached only through CQRS messages; the profile goes into this module.
  The password hash must never leave the API.
- Password handling stays in `AuthModule` (bcrypt); the minimum length of a new password matches registration
  (8 characters).
- Auth is a stateless JWT (`sub` + `email`): a password change does not invalidate already issued tokens, and the
  current token keeps working.
- The tus upload today requires `meetingId` in `Upload-Metadata` and creates a `MeetingFile` row; the avatar upload
  must not create meeting files or be visible in any meeting, and the meeting upload rules (2 GiB limit, owner-only)
  stay unchanged.
- `FILES_DIR` is never served statically: the avatar is delivered to the browser the way other files are (a link the
  API authorizes), and it must be reachable from the home page header without slowing the page down noticeably.
- Abandoned-upload cleanup and the orphan-file sweep must cover avatar files as well.
- Web: signed-in pages render their content keyed by the token (per-user state); the client-side type and size check
  mirrors the API allow-list.

## Acceptance criteria

- [ ] `GET` profile returns the signed-in user's e-mail, name (or `null`) and avatar (or `null`); `401` without a token;
      the response never contains the password hash.
- [ ] `PATCH` profile saves a trimmed name of 1-50 characters, treats an empty name as "not set", and rejects a longer
      name with `400`.
- [ ] `PATCH` profile sets an avatar from the user's own completed avatar upload and removes it on request; another
      user's upload or a missing one is rejected, and the replaced or removed avatar file is deleted from storage.
- [ ] An avatar upload outside PNG / JPEG / WebP or over 5 MB is rejected before data is stored; a file whose content
      does not match its type is rejected on completion and its data removed.
- [ ] An avatar upload creates no meeting file and needs no `meetingId`; existing meeting uploads behave as before
      (existing e2e suites pass).
- [ ] `POST` change password with the correct old password and a valid new one succeeds: login works with the new
      password and fails with the old one; the current token still works.
- [ ] `POST` change password with a wrong old password returns an error and the old password still works; a new
      password under 8 characters returns `400`.
- [ ] `/profile` shows the avatar or a placeholder, the name or the e-mail, and the e-mail; `/profile/edit` saves the
      name, uploads, replaces and removes the avatar, and changes the password with error messages for each failure
      above.
- [ ] The home page header shows the user's avatar (or placeholder) and name (or e-mail) and links to `/profile`;
      changes made on Profile Edit appear there without signing in again.
- [ ] Unauthenticated visits to `/profile` and `/profile/edit` redirect to `/login`.
- [ ] Every new or changed endpoint (profile `GET` / `PATCH`, change password, avatar upload and avatar delivery) is
      covered by e2e tests, including the error cases above.
