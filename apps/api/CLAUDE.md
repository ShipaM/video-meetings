# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Stack

NestJS 12 on Express, TypeScript 6, ESM (`"type": "module"`, `module: nodenext`), so **relative imports need the `.js` extension** (e.g. `./app.service.js`). Tests use Vitest; linting uses ESLint with `typescript-eslint` (type-checked rules) and `eslint-config-prettier`.

## Commands (from this directory, or use `--workspace=api` from the root)

```bash
npm run start:dev    # nest start --watch, http://localhost:4000 (PORT env overrides)
npm run build        # nest build -> dist/
npm run start:prod   # node dist/main
npm run lint | lint:fix
npm run test         # unit tests (src/**/*.spec.ts)
npm run test:e2e     # e2e tests (test/*.e2e-spec.ts, vitest.config.e2e.ts)
npx vitest run src/app.controller.spec.ts   # single test file
npx vitest run -t "name"                    # single test by name
```

## Architecture and routes

Standard Nest module/controller/service layout:

- `src/main.ts` - bootstrap, listens on `PORT ?? 4000`
- `src/app.module.ts` - root module
- `src/app.controller.ts` - `GET /` (returns a hello string via `AppService`)
- `src/app.service.ts` - business logic
- `test/app.e2e-spec.ts` - e2e test using supertest against the Nest app

## Documentation

Update this file when modules, routes or tooling of this app change.
