import { HttpException, Injectable } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Server, type ServerOptions } from '@tus/server';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard.js';
import {
  AuthorizeUploadRequestCommand,
  CancelUploadCommand,
  CompleteUploadCommand,
  CreateUploadCommand,
} from './commands/index.js';
import { FilesStorageService } from './files-storage.service.js';
import { MAX_FILE_SIZE } from './meeting-files.config.js';

type TusRequest = Parameters<NonNullable<ServerOptions['onIncomingRequest']>>[0];

/** Error shape `@tus/server` turns into an HTTP response (`status_code` + `body`). */
class TusHttpError extends Error {
  constructor(
    readonly status_code: number,
    readonly body: string,
  ) {
    super(body);
  }
}

/** Runs a hook body and maps Nest HTTP exceptions to tus errors, so tus answers with their status. */
async function tusHook<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof HttpException) {
      throw new TusHttpError(error.getStatus(), `${error.message}\n`);
    }
    throw error;
  }
}

/** The signed-in user set by `JwtAuthGuard` on the underlying Node request. */
function userIdOf(req: TusRequest): string {
  const user = (req.runtime?.node?.req as AuthenticatedRequest | undefined)?.user;
  if (!user) {
    throw new TusHttpError(401, 'Unauthorized\n');
  }
  return user.id;
}

/**
 * The tus 1.0 server (creation, termination, core protocol) for meeting file uploads, mounted under
 * `/uploads`.
 * Its hooks only dispatch CQRS messages; the upload id is the `MeetingFile` id.
 */
@Injectable()
export class TusService {
  readonly server: Server;

  constructor(commandBus: CommandBus, storage: FilesStorageService) {
    this.server = new Server({
      path: '/uploads',
      datastore: storage.store,
      maxSize: MAX_FILE_SIZE,
      relativeLocation: true,
      allowedOrigins: [process.env.WEB_ORIGIN ?? 'http://localhost:3000'],
      namingFunction: () => randomUUID(),
      onIncomingRequest: (req, uploadId) =>
        tusHook(async () => {
          // POST creates the upload; its checks live in onUploadCreate.
          if (req.method === 'DELETE') {
            // Cancel (termination): the row goes here, tus then removes the data under its lock.
            await commandBus.execute(new CancelUploadCommand(userIdOf(req), uploadId));
          } else if (req.method !== 'POST') {
            await commandBus.execute(
              new AuthorizeUploadRequestCommand(userIdOf(req), uploadId, req.method),
            );
          }
        }),
      onUploadCreate: (req, upload) =>
        tusHook(async () => {
          if (upload.size === undefined) {
            throw new TusHttpError(400, 'Upload-Length is required\n');
          }
          await commandBus.execute(
            new CreateUploadCommand(userIdOf(req), upload.id, upload.size, upload.metadata ?? {}),
          );
          return {};
        }),
      onUploadFinish: (_req, upload) =>
        tusHook(async () => {
          await commandBus.execute(new CompleteUploadCommand(upload.id));
          return {};
        }),
    });
  }

  handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    return this.server.handle(req, res);
  }
}
