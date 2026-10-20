import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard.js';
import { DeleteMeetingFileCommand, RetryFileProcessingCommand } from './commands/index.js';
import { INLINE_MIME_TYPES } from './meeting-files.config.js';
import type { FileLink, MeetingFileDetails } from './meeting-files.types.js';
import {
  GetFileContentQuery,
  GetFileLinkQuery,
  GetMeetingFileQuery,
  ListMeetingFilesQuery,
} from './queries/index.js';

@Controller()
export class MeetingFilesController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get('meetings/:id/files')
  @UseGuards(JwtAuthGuard)
  list(
    @Req() { user }: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) meetingId: string,
  ): Promise<MeetingFileDetails[]> {
    return this.queryBus.execute(new ListMeetingFilesQuery(user.id, meetingId));
  }

  @Get('meetings/:id/files/:fileId')
  @UseGuards(JwtAuthGuard)
  details(
    @Req() { user }: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) meetingId: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
  ): Promise<MeetingFileDetails> {
    return this.queryBus.execute(new GetMeetingFileQuery(user.id, meetingId, fileId));
  }

  /** Processes a failed document again: `202`, the file is `PROCESSING` until the job ends. */
  @Post('meetings/:id/files/:fileId/retry')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.ACCEPTED)
  retry(
    @Req() { user }: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) meetingId: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
  ): Promise<MeetingFileDetails> {
    return this.commandBus.execute(new RetryFileProcessingCommand(user.id, meetingId, fileId));
  }

  @Post('meetings/:id/files/:fileId/link')
  @UseGuards(JwtAuthGuard)
  link(
    @Req() { user }: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) meetingId: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
  ): Promise<FileLink> {
    return this.queryBus.execute(new GetFileLinkQuery(user.id, meetingId, fileId));
  }

  @Delete('meetings/:id/files/:fileId')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Req() { user }: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) meetingId: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
  ): Promise<void> {
    return this.commandBus.execute(new DeleteMeetingFileCommand(user.id, meetingId, fileId));
  }

  /**
   * Streams a file for a signed link (no bearer token: `<a download>`, `<img>` and `<iframe>`
   * cannot send one). `res.sendFile` handles Range, ETag and conditional requests.
   * `disposition=inline` serves a PDF or an image for a preview; anything else downloads.
   */
  @Get('files/:fileId/content')
  async content(
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @Query('token') token: string | undefined,
    @Query('disposition') disposition: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const file = await this.queryBus.execute(new GetFileContentQuery(fileId, token));

    // Sets `Content-Disposition: attachment` with an RFC 5987 `filename*` for non-ASCII names.
    res.attachment(file.originalName);
    const inline = disposition === 'inline' && INLINE_MIME_TYPES.includes(file.mimeType);
    if (inline) {
      // Same header with the inline type: the file name is kept for "Save as".
      res.set(
        'Content-Disposition',
        res.get('Content-Disposition')?.replace(/^attachment/, 'inline'),
      );
    }
    await new Promise<void>((resolve, reject) => {
      res.sendFile(
        file.path,
        {
          // A preview gets the whole file in one response: the token is checked when a request
          // starts, so a PDF viewer asking for more ranges after the 5 minutes would get 401.
          acceptRanges: !inline,
          headers: {
            'Content-Type': file.mimeType,
            'X-Content-Type-Options': 'nosniff',
            'Cache-Control': 'private, no-store',
            // The link carries a token: never leak it through Referer.
            'Referrer-Policy': 'no-referrer',
          },
        },
        (error) => {
          if (error && !res.headersSent) {
            reject(new NotFoundException('File not found'));
          } else {
            resolve();
          }
        },
      );
    });
  }
}
