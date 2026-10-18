import {
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { QueryBus } from '@nestjs/cqrs';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard.js';
import type { FileLink, MeetingFileView } from './meeting-files.types.js';
import { GetFileContentQuery, GetFileLinkQuery, ListMeetingFilesQuery } from './queries/index.js';

@Controller()
export class MeetingFilesController {
  constructor(private readonly queryBus: QueryBus) {}

  @Get('meetings/:id/files')
  @UseGuards(JwtAuthGuard)
  list(
    @Req() { user }: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) meetingId: string,
  ): Promise<MeetingFileView[]> {
    return this.queryBus.execute(new ListMeetingFilesQuery(user.id, meetingId));
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

  /**
   * Streams a file for a signed link (no bearer token: `<a download>` cannot send one).
   * `res.sendFile` handles Range, ETag and conditional requests.
   */
  @Get('files/:fileId/content')
  async content(
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @Query('token') token: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const file = await this.queryBus.execute(new GetFileContentQuery(fileId, token));

    // Sets `Content-Disposition: attachment` with an RFC 5987 `filename*` for non-ASCII names.
    res.attachment(file.originalName);
    await new Promise<void>((resolve, reject) => {
      res.sendFile(
        file.path,
        {
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
