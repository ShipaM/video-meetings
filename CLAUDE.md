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

The same file has an `ollama` service (`ollama/ollama`, port 11434, models in the `ollama_models` volume): the local LLM for document and transcript summaries. Start it with `docker compose up -d ollama` and pull the model once (`docker compose exec ollama ollama pull qwen3:4b`); the API uses it with `AI_PROVIDER=local` (see `apps/api/CLAUDE.md`). Recordings are transcribed by a local whisper.cpp build (`WHISPER_CLI_PATH`, model in the git-ignored `apps/api/models`), not a Docker service; ffmpeg and ffprobe come from npm packages.

Target one workspace with `npm run <script> --workspace=web|api`.

## Conventions

- Single Prettier config in the root `.prettierrc` (single quotes, trailing commas, width 100); ESLint config is per app.
- The repository is English-only: documentation, code comments and commit messages are in English.
- Commit messages and pull request descriptions never mention an AI assistant, chatbot or Claude Code: no
  "Generated with Claude Code" line, no `Co-Authored-By` trailer for an AI, plain conventional commits only.
- If `next build` fails with a `useContext` / prerender error, check that `NODE_ENV` is not set to `development` in the shell.

## Git hooks

Husky (`.husky/pre-commit`, installed by the root `prepare` script on `npm install`) runs `lint-staged` and then `npm test` before every commit. `lint-staged.config.mjs` runs ESLint `--fix` (through the owning workspace) and Prettier on the staged files. Bypass in an emergency with `git commit --no-verify`.

## Ralph loop

An autonomous loop that implements the open issues of GitHub milestones. `.claude/ralph.config.json` lists the `phases` (milestone and working branch each), the PR `base`, the per-issue prompt (`{issue}`, `{milestone}`, `{branch}` placeholders), `maxIterations` (issues per phase run) and `maxTurns` (per issue); `.claude/ralph.md` holds the rules the agent follows.

- `npm run ralph -- <phase>` (`scripts/ralph.mjs`, 1-based; without a number the first phase with open issues) switches to the phase branch (created from `origin/<base>` if missing), starts one `claude -p --permission-mode acceptEdits` run per issue, oldest first, and streams its progress. It stops when an issue is still open after its run, and pushes the branch and opens the pull request into `base` once the milestone has no open issues.
- `npm run ralph:all` (`scripts/ralph-all.mjs`) runs every phase in order with `--merge`: each phase's pull request is merged into `base` without review before the next phase starts. It stops at the first phase that does not finish; run it again to resume.

The agent runs load only the project MCP servers (`--strict-mcp-config`). In `-p` mode tools that `.claude/settings.json` does not allow are denied silently.

## MCP

`.mcp.json` in the root registers the project-scoped Playwright MCP server for browser automation. It runs `node node_modules/@playwright/mcp/cli.js` from the root devDependency `@playwright/mcp` (exact version), so start Claude Code from the repository root. Claude Code asks to approve it on first use. It is not started through `npx` on purpose: npx resolution takes about 10 s per start on Windows (the server itself about 1 s), and with several npx-based servers starting in parallel it often exceeds the 30 s MCP connection timeout. Bump the version deliberately.

## Keeping documentation up to date

When the project architecture changes (new app/package, routing, modules, scripts, ports, tooling), update this file and the affected `apps/*/CLAUDE.md` in the same change.
