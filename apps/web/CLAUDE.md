# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Stack

Next.js 16 (App Router, `src/` directory), React 19, TypeScript, Tailwind CSS 4 (via `@tailwindcss/turbopack`). Import alias `@/*` maps to `src/*`.

`next.config.ts` enables `cacheComponents` and `partialPrefetching`, and wires Tailwind through a Turbopack loader rule for `*.css`.

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
- `src/app/globals.css` - global styles / Tailwind entry
- `eslint.config.mjs` - flat ESLint config

## Documentation

Update this file when routes, structure or tooling of this app change.
