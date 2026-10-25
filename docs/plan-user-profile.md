# Plan: User profile

**PRD:** [prd-user-profile.md](prd-user-profile.md)
**Date**: 2026-10-25

## Implementation phases

### Phase 1: API tracer bullet - profile with a display name

**Goal:** A signed-in user reads their profile and sets or clears a display name through the API.
**Affects:** backend / database
**Tasks**

- [ ] Prisma: optional `User.name` and a migration.
- [ ] e2e tests first (`test/profile.e2e-spec.ts`): `GET /users/me` returns `{ email, name: null, avatar: null }` and
      never the password hash; `PATCH /users/me` trims and saves a 1-50 character name, an empty name stores `null`,
      51+ characters after trimming give `400`; `401` without a token for both.
- [ ] Users: `GetProfileQuery` (returns a `UserProfile` view, the hash is never loaded) and `UpdateProfileCommand`,
      exported from `src/users/index.ts`, with handler unit tests.
- [ ] `UsersController` (`GET` / `PATCH /users/me`, `JwtAuthGuard`, class-validator DTO); the module imports
      `AuthModule` for the guard only.
- [ ] Update `apps/api/CLAUDE.md` (Users routes, module table, dependency directions).
      **Done when:** the new e2e suite and all existing suites are green.

### Phase 2: UI - profile page, name editing and the header

**Goal:** The user sees their profile, edits the name, and the home page header shows who is signed in.
**Affects:** frontend
**Tasks**

- [ ] `/profile`: avatar placeholder, name (or the e-mail when not set), e-mail, "Edit" action; unauthenticated
      visits redirect to `/login`; content keyed by the token.
- [ ] `/profile/edit`: name field (client-side 50-character check, API `400` shown), save returns to `/profile`,
      cancel; unauthenticated visits redirect to `/login`.
- [ ] Home page header: placeholder and name (or e-mail) linking to `/profile`, refreshed after a save without signing
      in again.
- [ ] `ui-ux-pro-max`, phone width, Playwright MCP visual check; update `apps/web/CLAUDE.md`.
      **Done when:** in the browser a user sets, changes and clears the name and sees it (or the e-mail) on `/profile`
      and in the header; a signed-out visit to either page lands on `/login`.

### Phase 3: API - change password

**Goal:** The user changes their password with the old one; the current token keeps working.
**Affects:** backend
**Tasks**

- [ ] e2e tests first (`test/auth.e2e-spec.ts`): correct old password + valid new one succeeds, login then works with
      the new password and fails with the old one, the current token still opens `GET /users/me`; a wrong old password
      gives an error and the old password still works; a new password under 8 characters gives `400`; `401` without a
      token.
- [ ] Users: `UpdatePasswordHashCommand(userId, hash)` with a unit test.
- [ ] Auth: `POST /auth/password` (`{ oldPassword, newPassword }`, same minimum length as registration),
      `ChangePasswordCommand` handler (`FindUserByIdQuery`, bcrypt compare, hash, `UpdatePasswordHashCommand`) with a
      unit test.
- [ ] Update `apps/api/CLAUDE.md` (Auth routes and errors).
      **Done when:** e2e and unit suites are green.

### Phase 4: UI - change password form

**Goal:** The user changes the password from Profile Edit.
**Affects:** frontend
**Tasks**

- [ ] "Change password" action on `/profile` leading to the form on `/profile/edit`.
- [ ] Form with old password, new password and confirmation (reusing `password-field.tsx`); client checks for length
      and a matching confirmation; API errors (wrong old password, too short) shown; confirmation on success, the user
      stays signed in.
- [ ] `ui-ux-pro-max` + Playwright MCP visual check.
      **Done when:** in the browser the password changes and the next login works only with the new one; each error
      case shows its message.

### Phase 5: API - avatar upload through tus

**Goal:** A signed-in user uploads an avatar file through `/uploads` without a meeting; meeting uploads are unchanged.
**Affects:** backend / database
**Tasks**

- [ ] Prisma `UserAvatar` (id = tus upload id = storage key, user `onDelete: Cascade`, MIME type, size, status
      `UPLOADING | READY`, `lastChunkAt`) and a migration; move `FilesStorageService` into a shared storage module
      (no behaviour change).
- [ ] e2e tests first (`test/avatar-upload.e2e-spec.ts`): PNG, JPEG and WebP upload with `purpose=avatar` and no
      `meetingId`; another type `400` and over 5 MB `413` before any data is stored; content not matching the type
      `400` on completion with row and data removed; no `MeetingFile` created and nothing appears in any meeting;
      `HEAD` / `PATCH` / `DELETE` on another user's avatar upload `404`; `401` without a token.
- [ ] Users: `CreateAvatarUploadCommand` (allow-list + 5 MB), `CompleteAvatarUploadCommand` (magic bytes with
      `file-type`), `CancelAvatarUploadCommand`, and authorization of follow-up requests, with unit tests.
- [ ] `TusService` routes `purpose=avatar` uploads to the Users commands, everything else to the meeting commands as
      today (2 GiB limit, owner-only rules unchanged; existing meeting e2e suites green).
- [ ] Update `apps/api/CLAUDE.md` (upload metadata, avatar rules, storage layout).
      **Done when:** the new suite and all existing e2e suites are green.

### Phase 6: API - set, remove and deliver the avatar

**Goal:** The user attaches a completed avatar upload to the profile, removes it, and the browser can load it.
**Affects:** backend / database
**Tasks**

- [ ] e2e tests first: `PATCH /users/me` with `avatarUploadId` sets the user's own completed upload; another user's,
      a missing or an unfinished upload is rejected; `avatar: null` removes it; the replaced or removed file is gone
      from storage; `GET /users/me` returns the avatar URL (or `null`); the content route serves the image with its
      MIME type, `401` on a missing / invalid token, `404` once the avatar is replaced or removed.
- [ ] `User.avatarId` (unique, to `UserAvatar`) and a migration; `UpdateProfileCommand` sets / removes the avatar,
      deleting the previous row first and then its data.
- [ ] Signed avatar URL in `GetProfileQuery` (own JWT audience, expiry rounded to a window so the URL is stable
      between loads) and `GET /avatars/:id/content?token=` (re-checks that it is still the user's avatar,
      `Cache-Control: private, max-age`, `nosniff`, never static serving).
- [ ] Handler unit tests; update `apps/api/CLAUDE.md`.
      **Done when:** e2e and unit suites are green and storage holds only the current avatar of each test user.

### Phase 7: API - cleanup of abandoned and unattached avatars

**Goal:** Avatar uploads that are abandoned or never attached leave no file behind.
**Affects:** backend
**Tasks**

- [ ] e2e tests first: an avatar upload with no chunk for 24 h is removed with its data; a completed upload never
      attached to the profile is removed after the grace period; an attached avatar is kept; an avatar data file with
      no row is removed by the orphan sweep.
- [ ] Users: `CleanupAvatarUploadsCommand(cutoff)` (abandoned `UPLOADING` rows and `READY` rows not attached to a
      user), run by `StorageMaintenanceWorker` with the existing maintenance.
- [ ] `SweepOrphanFilesCommand` treats avatar storage keys as known (through a Users query), so it removes avatar
      orphans and never a live avatar.
- [ ] Unit tests; update `apps/api/CLAUDE.md` (maintenance section).
      **Done when:** e2e suites are green and the test storage directory has no avatar leftovers after cleanup and
      sweep.

### Phase 8: UI - avatar picker, profile and header avatar

**Goal:** The user uploads, replaces and removes the avatar on Profile Edit and sees it on the profile and in the
header.
**Affects:** frontend
**Tasks**

- [ ] Avatar picker on `/profile/edit` with preview, client-side PNG / JPEG / WebP and 5 MB check mirroring the API
      (message naming the reason), tus upload with `purpose=avatar` and a progress bar, remove avatar; save attaches or
      removes it, a content-mismatch error from the API is shown and the old avatar stays.
- [ ] Avatar shown cut to a circle on `/profile` and in the home page header (placeholder when none), updated after a
      save without signing in again.
- [ ] `ui-ux-pro-max` + Playwright MCP visual check (phone width); update `apps/web/CLAUDE.md`.
- [ ] Final check from the repository root: lint, type check, unit and e2e tests green.
      **Done when:** in the browser the user uploads with progress, replaces and removes an avatar and sees the change
      on `/profile` and in the header; a wrong type or a too large file is rejected before upload with its reason.

## Acceptance criteria coverage

| Acceptance criterion                                                             | Phase         |
| -------------------------------------------------------------------------------- | ------------- |
| `GET` profile: e-mail, name / `null`, avatar / `null`, `401`, no password hash   | 1, 6          |
| `PATCH` name: trimmed 1-50, empty is "not set", longer `400`                     | 1             |
| `PATCH` avatar: own completed upload, reject foreign / missing, old file deleted | 6             |
| Avatar type / size rejected before data; content mismatch rejected, data removed | 5             |
| Avatar upload: no meeting file, no `meetingId`; meeting uploads unchanged        | 5             |
| Change password succeeds, new login works, old fails, token still works          | 3, 4          |
| Wrong old password error, under 8 characters `400`                               | 3, 4          |
| `/profile` and `/profile/edit` behaviour with error messages                     | 2, 4, 8       |
| Header avatar / name links to `/profile`, updates without signing in again       | 2, 8          |
| Unauthenticated `/profile` and `/profile/edit` redirect to `/login`              | 2             |
| e2e for every new or changed endpoint incl. avatar upload and delivery           | 1, 3, 5, 6, 7 |
| Abandoned / unattached avatar uploads and orphans leave no file (constraint)     | 7             |
