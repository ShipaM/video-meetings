# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Stack

Next.js 16 (App Router, `src/` directory), React 19, TypeScript, Tailwind CSS 4 (via `@tailwindcss/postcss`), HeroUI v3 (`@heroui/react`, `@heroui/styles`; no provider, compound components, `onPress`). Import alias `@/*` maps to `src/*`.

`next.config.ts` enables `cacheComponents` and `partialPrefetching`.

Next.js here has breaking changes versus older versions: read the relevant guide in `node_modules/next/dist/docs/` before writing Next.js code (see `AGENTS.md`).

## Commands (from this directory, or use `--workspace=web` from the root)

```bash
npm run dev      # next dev, http://localhost:3000
npm run build    # next build (needs NODE_ENV=production or unset)
npm run start    # serve the production build
npm run lint     # ESLint (eslint-config-next + eslint-config-prettier)
npm run lint:fix
```

There is no test runner configured yet.

## Key files and routing

File-system routing under `src/app/`:

- `src/app/layout.tsx` - root layout
- `src/app/page.tsx` - `/` home, signed-in users only (client-side guard: no token redirects to `/login`): greeting with the e-mail from the JWT, meeting count, the 3 most recently created meetings from `GET /meetings` (each links to `/meetings/[id]`), "Create meeting" and "Log out"; a `401` clears the token
- `src/app/login/page.tsx` - `/login` form (`POST /auth/login`), stores the token and redirects to `/`; links to `/register`; redirects away when already signed in
- `src/app/register/page.tsx` - `/register` form (`POST /auth/register`), stores the token and redirects to `/`; links to `/login`
- `src/app/meetings/new/page.tsx` - `/meetings/new` form (`POST /meetings`), then back to `/`
- `src/app/meetings/[id]/page.tsx` - `/meetings/[id]` meeting page (params read inside a `Suspense` boundary, as Cache Components require); `meeting-view.tsx` loads `GET /meetings/:id` and `GET /meetings/:id/files` (`404` or a malformed id shows "Meeting not found", `401` clears the token)
- `src/app/meetings/[id]/upload-area.tsx` - file picker and drag-and-drop, one row with a progress bar per file; `use-file-uploads.ts` uploads through the API's tus endpoint (`POST /uploads`, `tus-js-client`, 32 MB chunks, at most 3 uploads at a time, resume within the page session) and refreshes the file list on success
- `src/app/meetings/[id]/file-types.ts` - client-side rejection (type allow-list and 2 GB limit, with the reason) before an upload starts; the allow-list in `meetings/[id]/constants.ts` mirrors `apps/api/src/meeting-files/file-types.ts`, keep both in sync
- `src/app/meetings/[id]/file-list.tsx` - completed files (name, type, size, upload date, status, download); download asks `POST /meetings/:id/files/:fileId/link` for a short-lived signed URL
- `src/app/auth-storage.ts` - access token in `localStorage` (key `accessToken`) with a `useAccessToken()` hook (`undefined` while hydrating, then token or `null`; syncs across tabs), `getEmailFromToken`
- `src/app/password-field.tsx` - shared password input with show/hide toggle; `src/app/meetings.ts` - `Meeting` / `MeetingFile` types, date and file size formatting
- `src/app/globals.css` - global styles: imports `tailwindcss` first, then `@heroui/styles`, plus the animated `.aurora` background and `.glass-card` styles
- `src/app/constants.ts` - API URL (`NEXT_PUBLIC_API_URL`, default `http://localhost:4000`), token key, email validation, theme storage key and the pre-hydration theme script; `src/app/register/constants.ts` - password limits (constants live in a `constants.ts` next to the component, not inline)
- `src/app/theme-toggle.tsx` - light/dark switch (`dark` class + `data-theme` on `<html>`, saved in `localStorage`; an inline script in `layout.tsx` applies it before hydration)
- `postcss.config.mjs` - PostCSS config with `@tailwindcss/postcss`
- `eslint.config.mjs` - flat ESLint config

## UI changes: mandatory visual check

For any change to the UI of this app:

- Always apply the `ui-ux-pro-max` skill.
- Always test the change visually through the Playwright MCP server (not any other browser tooling).
- The dev server is already running (http://localhost:3000); do not start it.
- The task is done only after the visual check has passed.

## Documentation

Update this file when routes, structure or tooling of this app change.
