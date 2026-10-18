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
npm run gen:secret   # prints a random 64-char hex string, use it as JWT_SECRET
npm run lint | lint:fix
npm run test         # unit tests (src/**/*.spec.ts, handlers with mocked Prisma / buses), see Testing
npm run test:e2e     # e2e tests (test/*.e2e-spec.ts, vitest.config.e2e.ts), need the database, see Testing
npx vitest run src/meeting-files/file-types.spec.ts   # single test file
npx vitest run -t "name"                    # single test by name
node scripts/upload-check.mjs <file> [mime]  # large upload check against a running API, see Meeting files
```

## Architecture and routes

Standard Nest module/controller/service layout:

- `src/main.ts` - bootstrap, listens on `PORT ?? 4000`; CORS for `WEB_ORIGIN` (exposes the tus headers)
- `src/app.module.ts` - root module (no routes of its own)
- `src/prisma/` - global `PrismaModule` / `PrismaService` (Prisma 7 with the `@prisma/adapter-pg` driver adapter)
- `src/auth/` - `AuthModule`: `POST /auth/register` and `POST /auth/login`, token issuing and `JwtAuthGuard` (see below)
- `src/users/` - `UsersModule`: creating and looking up users, no HTTP routes yet (see below)
- `src/meetings/` - `MeetingsModule`: `POST /meetings`, `GET /meetings`, `GET /meetings/:id` (see below)
- `src/meeting-files/` - `MeetingFilesModule`: resumable upload (tus), file list and signed downloads (see below)
- `prisma/schema.prisma`, `prisma/migrations/`, `prisma.config.ts` - Prisma schema (`User`, `Meeting`, `MeetingFile`), migrations and CLI config
- `test/auth.e2e-spec.ts`, `test/meetings.e2e-spec.ts`, `test/meeting-files.e2e-spec.ts` - e2e tests using supertest against the Nest app and the real database (written first, TDD); `test/tus.helpers.ts` - tus metadata, fake MP4, interrupted PATCH, binary body parser
- `src/**/handlers/*.handler.spec.ts` - unit tests of the CQRS handlers (Prisma and the buses are mocked)
- `scripts/upload-check.mjs` - manual large-upload check with `tus-js-client` (not part of any test run)

## Modules

`AppModule` imports `CqrsModule.forRoot()` (global `CommandBus` / `QueryBus`), `PrismaModule` (global) and the four feature modules:

| Module               | Responsibility                                                                | Public surface                                                                                           | Talks to                                                                                     |
| -------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `AuthModule`         | registration, login, password hashing, JWT issuing and verification           | `POST /auth/register`, `POST /auth/login`, `JwtAuthGuard`, `JwtModule`                                   | Users, through `CreateUserCommand` / `FindUserByEmailQuery`                                  |
| `UsersModule`        | the `User` table: creating and looking users up (profile etc. will live here) | CQRS messages from `src/users/index.ts`, no HTTP routes yet                                              | Prisma only                                                                                  |
| `MeetingsModule`     | meetings owned by the signed-in user                                          | `POST /meetings`, `GET /meetings`, `GET /meetings/:id`; `GetMeetingQuery` (`src/meetings/index.ts`)      | imports `AuthModule` for `JwtAuthGuard`                                                      |
| `MeetingFilesModule` | the `MeetingFile` table and the files on disk (`FILES_DIR`)                   | `/uploads` (tus), `GET /meetings/:id/files`, `POST .../files/:fileId/link`, `GET /files/:fileId/content` | Meetings, through `GetMeetingQuery` (ownership); `AuthModule` for the guard and `JwtService` |

Dependencies point one way: MeetingFiles -> (buses) -> Meetings -> Auth -> (buses) -> Users. Users knows nothing about Auth, Meetings nothing about files.

Layout of a feature module (Auth, Users, Meetings and MeetingFiles follow it):

```
src/<module>/
  <module>.module.ts        # providers: [...CommandHandlers, ...QueryHandlers]
  <module>.controller.ts    # Auth, Meetings, MeetingFiles; builds messages, dispatches them
  dto/                      # class-validator request bodies
  commands/  <name>.command.ts, handlers/<name>.handler.ts (+ .spec.ts), index.ts
  queries/   <name>.query.ts,   handlers/<name>.handler.ts (+ .spec.ts), index.ts
  index.ts                  # Users, Meetings: the public API other modules import
```

Auth additionally has `token.service.ts` (signs the JWT), `jwt-auth.guard.ts` and `auth.constants.ts` (bcrypt rounds).

## Auth

Both routes take `{ email, password }` and return `201 { accessToken }` (JWT, payload `sub` + `email`). Passwords are hashed with bcrypt; e-mails are stored lower-cased.

| Route                 | Errors                                                                                               |
| --------------------- | ---------------------------------------------------------------------------------------------------- |
| `POST /auth/register` | `400` invalid e-mail / missing or too short (<8) password, `409` e-mail taken                        |
| `POST /auth/login`    | `400` invalid e-mail / missing password, `401` unknown e-mail or wrong password (no user is created) |

Auth registers `TokenService` (`issue(userId, email)` signs `{ sub, email }`) and `JwtAuthGuard`; it exports `JwtModule` and the guard, which is how Meetings protects its routes.

A global `ValidationPipe` (`whitelist: true`) is registered in `src/main.ts` and in the e2e tests; without it DTO validation does not return `400`.

## Users

`UsersModule` owns the `User` table; no other module touches `prisma.user`. It has no controller, it is reached only through CQRS messages, which are exported from `src/users/index.ts` (the module's public API):

| Message                          | Result                                                                                    |
| -------------------------------- | ----------------------------------------------------------------------------------------- |
| `CreateUserCommand(email, hash)` | the stored `UserRecord`; lower-cases the e-mail, `409 ConflictException` when it is taken |
| `FindUserByEmailQuery(email)`    | `UserRecord` or `null`; the lookup is case-insensitive (the e-mail is lower-cased)        |
| `FindUserByIdQuery(id)`          | `UserRecord` or `null`                                                                    |

`UserRecord` (`id`, `email`, `passwordHash`) is internal: never return it from a controller. Profile and other user features go into this module.

Auth does the credential work and talks to Users over the buses: `RegisterUserHandler` hashes the password with bcrypt and dispatches `CreateUserCommand`; `LoginHandler` dispatches `FindUserByEmailQuery`, compares the hash and issues the JWT through `TokenService`. Auth never imports Prisma.

## Meetings

All routes require `Authorization: Bearer <accessToken>` (`JwtAuthGuard` in `src/auth/`, exported by `AuthModule`; it verifies the JWT and sets `request.user = { id, email }`, typed as `AuthenticatedRequest`). Missing or invalid token gives `401`.

| Route               | Behaviour                                                                                |
| ------------------- | ---------------------------------------------------------------------------------------- |
| `POST /meetings`    | body `{ title, startsAt }` (ISO date), `201` with the meeting; `400` on missing/invalid  |
| `GET /meetings`     | `200`, only the caller's meetings, ordered by `startsAt`                                 |
| `GET /meetings/:id` | `200`; `404` if it does not exist **or belongs to another user**; `400` on a non-UUID id |

The `Meeting` Prisma model belongs to a `User` (`onDelete: Cascade`).

## Meeting files

`MeetingFilesModule` (`src/meeting-files/`) stores files of a meeting on local disk. Design and library choices: `docs/research-meeting-upload.md` (repository root). In Phase 1 only the meeting owner has access.

### Resumable upload (tus 1.0)

`@tus/server` + `@tus/file-store` run inside `UploadsController` (`TusService`), behind `JwtAuthGuard`; the tus hooks only dispatch CQRS messages. Upload id = `MeetingFile.id` (UUID). The meeting id travels in `Upload-Metadata` (`meetingId`, `filename`, `filetype`, base64), not in the URL. Every request needs `Tus-Resumable: 1.0.0` (else `412`).

| Route                | Behaviour                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /uploads`      | `Upload-Length` + `Upload-Metadata`; `201` with `Location: /uploads/<id>`, creates an `UPLOADING` row (`CreateUploadCommand`). `413` over 2 GiB, `400` missing metadata or a type outside the allow-list, `404` foreign/missing meeting, `507` when free space minus the bytes active uploads still have to write (uploads with a chunk in the last 24 h) is below the size + 512 MiB |
| `HEAD /uploads/:id`  | `200` with `Upload-Offset` / `Upload-Length`; `404` if the upload is not the caller's (`AuthorizeUploadRequestCommand`)                                                                                                                                                                                                                                                               |
| `PATCH /uploads/:id` | `Upload-Offset` + `Content-Type: application/offset+octet-stream`; `204` with the new offset, `409` on an offset mismatch or a completed upload, `404` if not the caller's. Each PATCH sets `lastChunkAt`; the last chunk runs `CompleteUploadCommand`                                                                                                                                |

Completion checks the magic bytes (`file-type`; TXT: valid UTF-8 without NUL) against the stored type: a mismatch deletes the row and the data and answers `400`; otherwise the file becomes `READY` (no processing yet). If completion fails with an unexpected error (e.g. the database), tus never calls the hook again; so `HEAD` / `PATCH` on an `UPLOADING` file whose bytes are all stored runs `CompleteUploadCommand` again (the client's retry). `CompleteUploadCommand` is idempotent (conditional `updateMany` / `deleteMany`). An unreadable data file counts as a type mismatch. tus `GET` / `DELETE` are not routed. The allow-list (extension primary, declared MIME must agree, empty or `application/octet-stream` accepted) lives in `file-types.ts`.

### List and download

| Route                                   | Behaviour                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /meetings/:id/files`               | bearer token; `200` completed files (not `UPLOADING`), newest first, `size` as a number; `404` foreign meeting, `400` non-UUID                                                                                                                                                                                                                                      |
| `POST /meetings/:id/files/:fileId/link` | bearer token; `201 { url, expiresAt }`, `url` = `/files/:fileId/content?token=...` (relative to the API), valid 5 minutes; `404` foreign/missing/`UPLOADING` file                                                                                                                                                                                                   |
| `GET /files/:fileId/content?token=`     | **no** bearer token (for `<a download>`); `401` missing/invalid/expired token or a token for another file, `404` when access is gone; streams with `res.sendFile` (Range, ETag), `Content-Type` = stored MIME, `Content-Disposition: attachment` with the original name (RFC 5987 `filename*` for non-ASCII), `nosniff`, `no-store`, `Referrer-Policy: no-referrer` |

Link tokens are JWTs signed with `FILE_LINK_SECRET` and audience `file-content` (`{ sub: userId, fileId }`), so access tokens and link tokens are not interchangeable. The content route re-checks access in the database (`GetMeetingQuery`), so a deleted file or lost access stops working before the link expires.

### Storage

`FILES_DIR` (default `./storage`, relative to the working directory, i.e. `apps/api` for npm scripts; git-ignored) is resolved and created at startup and **never served statically** (do not add `ServeStaticModule`). Layout: `uploads/<storageKey>` (data, written in place by tus; `storageKey` = file id, never user input) and `uploads/<storageKey>.json` (tus metadata). Original name, MIME type, kind and size live only in the database. `MeetingFile.size` is `BigInt` (2 GiB overflows `integer`).

### Large upload check

`scripts/upload-check.mjs` uploads a file with `tus-js-client` (32 MiB chunks) to a running API, checks name/size/type in the list, downloads it through a signed link and compares SHA-256. It registers a throwaway `upload-check-<ts>@example.com` user unless `EMAIL` / `PASSWORD` are set; `API_URL` defaults to `http://localhost:4000`. A 2 GiB file takes about a minute locally.

### CQRS pattern (auth, users, meetings and meeting files)

Controllers hold no logic: they build a `Command` (writes) or `Query` (reads) and dispatch it through `CommandBus` / `QueryBus`. Each module has `commands/` and `queries/` with the message class, a `handlers/` folder and an `index.ts` exporting the handler array that the module lists in `providers`. Handlers use `PrismaService` directly (no service layer), except Auth handlers, which call Users through the buses. Modules do not import each other's handlers or Prisma models; they send the other module's exported messages (`CommandBus` / `QueryBus` are global thanks to `CqrsModule.forRoot()` in `AppModule`). Authorization of data is done in the handler by filtering on `ownerId`.

## Testing

Two kinds of tests, both on Vitest (`globals: true`, so `describe` / `it` / `vi` need no import):

| Kind | Files                | Config                 | Needs                                 | What it covers                                                                               |
| ---- | -------------------- | ---------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------- |
| Unit | `src/**/*.spec.ts`   | `vitest.config.ts`     | nothing (Prisma and the buses mocked) | each CQRS handler in isolation (Auth, Users, MeetingFiles), the file type allow-list         |
| e2e  | `test/*.e2e-spec.ts` | `vitest.config.e2e.ts` | the database, `.env`                  | the whole Nest app over HTTP with supertest: `/auth/*`, `/meetings*`, `/uploads`, `/files/*` |

### Running unit tests

No setup is needed:

```bash
npm run test --workspace=api                              # all unit tests (from the root; `npm run test` there runs the same)
npm run test:watch                                        # re-run on change (from apps/api)
npm run test:cov                                          # with coverage
npx vitest run src/users                                  # one folder
npx vitest run src/auth/queries/handlers/login.handler.spec.ts   # one file
npx vitest run -t "rejects a wrong password"              # one test by name
```

### Running e2e tests

e2e tests talk to the real PostgreSQL database, so prepare it once:

1. From the repository root: `npm run db:up` (PostgreSQL in Docker; wait for the healthcheck).
2. `cp apps/api/.env.example apps/api/.env` and fill in `DATABASE_URL`, `JWT_SECRET` and `FILE_LINK_SECRET` (`npm run gen:secret --workspace=api` prints one).
3. `npm run prisma:migrate --workspace=api` to apply the migrations.

Then run them (there is no root-level e2e script):

```bash
npm run test:e2e --workspace=api                          # all e2e suites (from the root)
npx vitest run --config ./vitest.config.e2e.ts test/auth.e2e-spec.ts   # one suite (from apps/api)
npx vitest run --config ./vitest.config.e2e.ts -t "POST /auth/login"   # one test by name
```

Suites run one after another (`fileParallelism: false`) because they share the database. Each suite uses unique e-mails (`<name>-<timestamp>@example.com`) and deletes the users it created in `afterAll`, so reruns do not collide and the data stays clean; a crashed run can leave a few `*-<timestamp>@example.com` rows behind. `meeting-files.e2e-spec.ts` sets `FILES_DIR` to a fresh temporary directory before the app is created and removes it in `afterAll`; it listens on a real port (`app.listen(0)`) to cut a `PATCH` mid-stream for the resume test.

### Before you finish a change

Run lint, type check, unit and e2e tests and make sure all are green; start from a green baseline and re-run after each step of a refactor:

```bash
npm run lint && npx tsc --noEmit && npm run test && npm run test:e2e
```

### Writing tests

- Handler unit tests construct the handler directly with mocks (`{ user: { create } } as unknown as PrismaService`, `{ execute } as unknown as CommandBus`) and assert on the message sent and the result; keep the file next to the handler as `<name>.handler.spec.ts`.
- Reset mocks in `beforeEach(() => { mock.mockReset(); })` with braces: returning the mock from the callback makes Vitest call it as a cleanup function.
- New HTTP behaviour gets an e2e case first (TDD, as in `test/meetings.e2e-spec.ts`). The e2e app must register the same global `ValidationPipe({ whitelist: true })` as `main.ts`, otherwise DTO validation does not return `400`.

## Environment

Copy `.env.example` to `apps/api/.env` (`DATABASE_URL`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `FILES_DIR`, `FILE_LINK_SECRET`; optional `WEB_ORIGIN` for CORS, default `http://localhost:3000`). Without `FILE_LINK_SECRET` the app refuses to start (`MeetingFilesModule.onModuleInit`). `main.ts` loads it through `dotenv/config`; e2e tests load it via `setupFiles` in `vitest.config.e2e.ts`. The generated client (`src/generated`) is git-ignored. e2e tests need the database (`npm run db:up`, then `npm run prisma:migrate`) and delete the users they create in `afterAll`.

## Documentation

Update this file when modules, routes or tooling of this app change.
