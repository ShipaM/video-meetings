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
npm run test:e2e --workspace=api   # api e2e tests (need `npm run db:up` and apps/api/.env, see apps/api/CLAUDE.md)
npm run db:up | db:down     # start / stop PostgreSQL via Docker Compose
```

## Database

`docker-compose.yml` in the root runs PostgreSQL 17 (`postgres:17-alpine`) on port 5432 with a persistent `postgres_data` volume and a healthcheck. Defaults (user/password `postgres`, database `video_meetings`) can be overridden through a root `.env` file; see `.env.example`. The API uses Prisma (`apps/api/prisma`) with its own `apps/api/.env` (see `apps/api/.env.example`).

Target one workspace with `npm run <script> --workspace=web|api`.

## Conventions

- Single Prettier config in the root `.prettierrc` (single quotes, trailing commas, width 100); ESLint config is per app.
- The repository is English-only: documentation, code comments and commit messages are in English.
- Commit messages and pull request descriptions never mention an AI assistant, chatbot or Claude Code: no
  "Generated with Claude Code" line, no `Co-Authored-By` trailer for an AI, plain conventional commits only.
- If `next build` fails with a `useContext` / prerender error, check that `NODE_ENV` is not set to `development` in the shell.

## Git hooks

Husky (`.husky/pre-commit`, installed by the root `prepare` script on `npm install`) runs `lint-staged` and then `npm test` before every commit. `lint-staged.config.mjs` runs ESLint `--fix` (through the owning workspace) and Prettier on the staged files. Bypass in an emergency with `git commit --no-verify`.

## MCP

`.mcp.json` in the root registers the project-scoped Playwright MCP server (`npx @playwright/mcp@latest`, started via `cmd /c` on Windows) for browser automation. Claude Code asks to approve it on first use; on macOS/Linux change the command to plain `npx`.

## Keeping documentation up to date

When the project architecture changes (new app/package, routing, modules, scripts, ports, tooling), update this file and the affected `apps/*/CLAUDE.md` in the same change.
