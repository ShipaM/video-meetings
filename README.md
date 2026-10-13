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
