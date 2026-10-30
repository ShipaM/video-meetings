# video-meetings

NPM monorepo (npm workspaces) with two applications:

| App        | Path       | Stack   | Default port |
| ---------- | ---------- | ------- | ------------ |
| Web client | `apps/web` | Next.js | 3000         |
| API server | `apps/api` | NestJS  | 4000         |

## Getting started

```bash
npm install
npm run dev        # runs web and api together
```

## Scripts (run from the repository root)

| Script                            | Description                     |
| --------------------------------- | ------------------------------- |
| `npm run dev`                     | Start web and api in watch mode |
| `npm run dev:web` / `dev:api`     | Start a single app              |
| `npm run build`                   | Build all apps                  |
| `npm run lint` / `lint:fix`       | Run ESLint in all workspaces    |
| `npm run format` / `format:check` | Run Prettier on the whole repo  |
| `npm run test`                    | Run unit tests                  |

## Tooling

- ESLint per app (`apps/web/eslint.config.mjs`, `apps/api/eslint.config.mjs`)
- Single Prettier config in the root (`.prettierrc`)

## Ralph loop

An autonomous loop that implements the open issues of GitHub milestones. `.claude/ralph.config.json` lists the `phases` (milestone and working branch each), the PR `base`, the per-issue prompt (`{issue}`, `{milestone}`, `{branch}` placeholders), `maxIterations` (issues per phase run) and `maxTurns` (per issue); `.claude/ralph.md` holds the rules the agent follows.

- `npm run ralph -- <phase>` (`scripts/ralph.mjs`, 1-based; without a number the first phase with open issues) switches to the phase branch (created from `origin/<base>` if missing), starts one `claude -p --permission-mode acceptEdits` run per issue, oldest first, and streams its progress. It stops when an issue is still open after its run, and pushes the branch and opens the pull request into `base` once the milestone has no open issues.
- `npm run ralph:all` (`scripts/ralph-all.mjs`) runs every phase in order with `--merge`: each phase's pull request is merged into `base` without review before the next phase starts. It stops at the first phase that does not finish; run it again to resume.

UI issues are checked in the browser through Playwright MCP against the dev servers: after switching to the phase branch the runner stops whatever listens on :3000 and :4000 (watch builds miss changes on a branch switch, so older servers may serve stale code), starts `npm run dev` itself (output in the git-ignored `.claude/ralph.dev.log`) and stops it when the phase run ends. The API needs PostgreSQL (`npm run db:up`). The agent runs load only the project MCP servers (`--strict-mcp-config`).
