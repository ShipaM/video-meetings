# CLAUDE.md

## Overview

`video-meetings` is an **npm workspaces** monorepo (npm only, not pnpm/yarn) with two apps:

| App        | Path       | Stack                                         | Port |
| ---------- | ---------- | --------------------------------------------- | ---- |
| Web client | `apps/web` | Next.js 16 (App Router), React 19, Tailwind 4 | 3000 |
| API server | `apps/api` | NestJS 12, Vitest                             | 4000 |

The apps are independent packages (no shared package yet). Per-app details live in `apps/web/CLAUDE.md` and `apps/api/CLAUDE.md`.

## Commands

Scripts are in the root `package.json`; run them from the repository root. Target one workspace with
`npm run <script> --workspace=web|api`. API e2e tests: `npm run test:e2e --workspace=api` (need
`npm run db:up` and `apps/api/.env`, see `apps/api/CLAUDE.md`). Only the API has tests. There is no
typecheck script: `npx tsc --noEmit -p apps/web|apps/api`.

## Database

`docker-compose.yml` in the root runs PostgreSQL 17 (`postgres:17-alpine`) on port 5432 with a persistent `postgres_data` volume and a healthcheck. Defaults (user/password `postgres`, database `video_meetings`) can be overridden through a root `.env` file; see `.env.example`. The API uses Prisma (`apps/api/prisma`) with its own `apps/api/.env` (see `apps/api/.env.example`).

The same file has an `ollama` service, the local LLM for summaries; setup and the whisper.cpp transcription are described in `apps/api/CLAUDE.md`.

## Conventions

- Single Prettier config in the root `.prettierrc`; ESLint config is per app.
- The repository is English-only: documentation, code comments and commit messages are in English.
- Commit messages and pull request descriptions never mention an AI assistant, chatbot or Claude Code: no
  "Generated with Claude Code" line, no `Co-Authored-By` trailer for an AI, plain conventional commits only.
- Commit scopes are `web`, `api` or `scripts` (e.g. `feat(api): ...`); work happens on `feature/*` or `chore/*`
  branches merged into `master` through pull requests.

## Git hooks

Husky (`.husky/pre-commit`, installed by the root `prepare` script on `npm install`) runs `lint-staged` and then `npm test` before every commit. `lint-staged.config.mjs` runs ESLint `--fix` (through the owning workspace) and Prettier on the staged files.

## Ralph loop

An autonomous loop (`npm run ralph`, `npm run ralph:all`) that implements the open issues of GitHub milestones; see the README. Its agents follow `.claude/ralph.md`.

- The runner starts and stops the dev servers itself: do not keep your own dev servers running during a Ralph run.
- Agent runs use `claude -p`, where tools that `.claude/settings.json` does not allow are denied silently.

## MCP

`.mcp.json` in the root registers the project-scoped Playwright MCP server. It runs `node node_modules/@playwright/mcp/cli.js` from the root devDependency `@playwright/mcp` (exact version, bump deliberately), so start Claude Code from the repository root. Not through `npx` on purpose: npx resolution on Windows makes parallel server starts exceed the 30 s MCP connection timeout.

## Saving tokens

Every message resends the whole context, so keep what enters it small.

Command output:

- Tests: run by pattern (`npm test --workspace=api -- <path part>`, `-t <test name>`), not the whole suite; add `--silent` when you only need to confirm there are no failures.
- `git diff`: use `--unified=1` for compact hunks.
- `git log`: use `--oneline -10` unless the details are needed.
- `tsc --noEmit`: read only the tail of the output (e.g. `| tail -20`).
- Logs and other long output (e.g. `.claude/ralph.dev.log`): filter with `grep` / `tail` instead of reading them whole.

Reading and tools:

- Search before reading: find the symbol with Grep, then read only the lines around it (`offset` / `limit`), not whole large files such as `apps/api/CLAUDE.md`.
- Prefer CLI tools over MCP servers when both work (e.g. `gh` for GitHub); keep Playwright MCP for UI checks.
- Hand verbose work whose details you do not need (wide searches, full e2e runs, long docs) to a subagent so only its summary returns; give simple subagent tasks `model: haiku`.

### Compact instructions

When compacting, keep the files changed and why, the last test and typecheck results, and open decisions or
questions; drop file contents that can be read again.

## Keeping documentation up to date

When the project architecture changes (new app/package, routing, modules, scripts, ports, tooling), update this file and the affected `apps/*/CLAUDE.md` in the same change. Keep each `CLAUDE.md` under 200 lines with only what applies to most tasks: it is loaded into every session, so move workflow-specific instructions into a skill (`.claude/skills/`), which loads only when used.
