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
- `src/app/page.tsx` - `/` route
- `src/app/globals.css` - global styles: imports `tailwindcss` first, then `@heroui/styles`, plus the animated `.aurora` background and `.glass-card` styles
- `src/app/register/page.tsx` - `/register` form (HeroUI, native `fetch` to `POST /auth/register`; API base from `NEXT_PUBLIC_API_URL`, default `http://localhost:4000`)
- `src/app/constants.ts` - theme storage key and the pre-hydration theme script; `src/app/register/constants.ts` - API URL and email/password validation limits (constants live in a `constants.ts` next to the component, not inline)
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
