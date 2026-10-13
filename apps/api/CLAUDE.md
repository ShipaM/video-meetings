# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Stack

NestJS 12 on Express, TypeScript 6, ESM (`"type": "module"`, `module: nodenext`), so **relative imports need the `.js` extension** (e.g. `./app.service.js`). Tests use Vitest; linting uses ESLint with `typescript-eslint` (type-checked rules) and `eslint-config-prettier`.

## Commands (from this directory, or use `--workspace=api` from the root)

```bash
npm run start:dev    # nest start --watch, http://localhost:4000 (PORT env overrides)
npm run build        # prisma generate + nest build -> dist/
npm run prisma:migrate   # prisma migrate dev (needs `npm run db:up` from the root)
npm run prisma:generate  # regenerate the client in src/generated/prisma (also runs on postinstall)
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
- `src/prisma/` - global `PrismaModule` / `PrismaService` (Prisma 7 with the `@prisma/adapter-pg` driver adapter)
- `src/auth/` - `AuthModule`: `POST /auth/register` and `POST /auth/login` (see below)
- `prisma/schema.prisma`, `prisma/migrations/`, `prisma.config.ts` - Prisma schema (`User`), migrations and CLI config
- `test/app.e2e-spec.ts`, `test/auth.e2e-spec.ts` - e2e tests using supertest against the Nest app and the real database

## Auth

Both routes take `{ email, password }` and return `201 { accessToken }` (JWT, payload `sub` + `email`). Passwords are hashed with bcrypt; e-mails are stored lower-cased.

| Route                 | Errors                                                                                               |
| --------------------- | ---------------------------------------------------------------------------------------------------- |
| `POST /auth/register` | `400` invalid e-mail / missing or too short (<8) password, `409` e-mail taken                        |
| `POST /auth/login`    | `400` invalid e-mail / missing password, `401` unknown e-mail or wrong password (no user is created) |

A global `ValidationPipe` (`whitelist: true`) is registered in `src/main.ts` and in the e2e tests; without it DTO validation does not return `400`.

## Environment

Copy `.env.example` to `apps/api/.env` (`DATABASE_URL`, `JWT_SECRET`, `JWT_EXPIRES_IN`). `main.ts` loads it through `dotenv/config`; e2e tests load it via `setupFiles` in `vitest.config.e2e.ts`. The generated client (`src/generated`) is git-ignored. e2e tests need the database (`npm run db:up`, then `npm run prisma:migrate`) and delete the users they create in `afterAll`.

## Documentation

Update this file when modules, routes or tooling of this app change.
