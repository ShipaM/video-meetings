import { HttpException, Injectable } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Server, type ServerOptions, type Upload } from '@tus/server';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard.js';
import {
  AuthorizeAvatarUploadRequestCommand,
  CancelAvatarUploadCommand,
  CompleteAvatarUploadCommand,
  CreateAvatarUploadCommand,
} from '../users/index.js';
import {
  AuthorizeUploadRequestCommand,
  CancelUploadCommand,
  CompleteUploadCommand,
  CreateUploadCommand,
} from './commands/index.js';
import { FilesStorageService } from '../storage/files-storage.service.js';
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

/** `Upload-Metadata` of an avatar upload: `purpose=avatar` and no `meetingId`. */
function isAvatar(metadata: Upload['metadata']): boolean {
  return metadata?.purpose === 'avatar';
}

/**
 * The tus 1.0 server (creation, termination, core protocol) for meeting file and avatar uploads,
 * mounted under `/uploads`.
 * Its hooks only dispatch CQRS messages: `purpose=avatar` uploads go to the Users commands (the
 * upload id is the `UserAvatar` id), all others to the meeting file commands (the `MeetingFile` id).
 */
@Injectable()
export class TusService {
  readonly server: Server;

  constructor(commandBus: CommandBus, storage: FilesStorageService) {
    /** Whether an existing upload is an avatar, from the tus metadata stored at creation. */
    const isAvatarUpload = async (uploadId: string): Promise<boolean> => {
      // No metadata: a missing upload, which the meeting file commands answer with 404 as before.
      const upload = await storage.store.getUpload(uploadId).catch(() => null);
      return isAvatar(upload?.metadata);
    };

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
          if (req.method === 'POST') {
            return;
          }
          const userId = userIdOf(req);
          const avatar = await isAvatarUpload(uploadId);
          if (req.method === 'DELETE') {
            // Cancel (termination): the row goes here, tus then removes the data under its lock.
            await commandBus.execute(
              avatar
                ? new CancelAvatarUploadCommand(userId, uploadId)
                : new CancelUploadCommand(userId, uploadId),
            );
          } else {
            await commandBus.execute(
              avatar
                ? new AuthorizeAvatarUploadRequestCommand(userId, uploadId, req.method)
                : new AuthorizeUploadRequestCommand(userId, uploadId, req.method),
            );
          }
        }),
      onUploadCreate: (req, upload) =>
        tusHook(async () => {
          if (upload.size === undefined) {
            throw new TusHttpError(400, 'Upload-Length is required\n');
          }
          const metadata = upload.metadata ?? {};
          await commandBus.execute(
            isAvatar(metadata)
              ? new CreateAvatarUploadCommand(userIdOf(req), upload.id, upload.size, metadata)
              : new CreateUploadCommand(userIdOf(req), upload.id, upload.size, metadata),
          );
          return {};
        }),
      onUploadFinish: (_req, upload) =>
        tusHook(async () => {
          await commandBus.execute(
            isAvatar(upload.metadata)
              ? new CompleteAvatarUploadCommand(upload.id)
              : new CompleteUploadCommand(upload.id),
          );
          return {};
        }),
    });
  }

  handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    return this.server.handle(req, res);
  }
}
