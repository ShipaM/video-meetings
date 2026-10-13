# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

`video-meetings` is an **npm workspaces** monorepo (npm only, not pnpm/yarn) with two apps:

| App        | Path       | Stack                                         | Port |
| ---------- | ---------- | --------------------------------------------- | ---- |
| Web client | `apps/web` | Next.js 16 (App Router), React 19, Tailwind 4 | 3000 |
| API server | `apps/api` | NestJS 12, Vitest                             | 4000 |

The apps are independent packages (no shared package yet). Per-app details live in `apps/web/CLAUDE.md` and `apps/api/CLAUDE.md`.

## Commands (run from the repository root)

```bash
npm install                 # installs all workspaces
npm run dev                 # web + api together (concurrently)
npm run dev:web | dev:api   # single app
npm run build               # build all apps
npm run lint | lint:fix     # ESLint in every workspace
npm run format | format:check   # Prettier for the whole repo
npm run test                # unit tests (api)
```

Target one workspace with `npm run <script> --workspace=web|api`.

## Conventions

- Single Prettier config in the root `.prettierrc` (single quotes, trailing commas, width 100); ESLint config is per app.
- The repository is English-only: documentation, code comments and commit messages are in English.
- If `next build` fails with a `useContext` / prerender error, check that `NODE_ENV` is not set to `development` in the shell.

## Keeping documentation up to date

When the project architecture changes (new app/package, routing, modules, scripts, ports, tooling), update this file and the affected `apps/*/CLAUDE.md` in the same change.
