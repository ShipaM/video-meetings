import {
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Query,
  Res,
} from '@nestjs/common';
import { QueryBus } from '@nestjs/cqrs';
import type { Response } from 'express';
import { GetAvatarContentQuery } from './queries/index.js';
import { AVATAR_LINK_WINDOW_SECONDS } from './users.config.js';

@Controller('avatars')
export class AvatarsController {
  constructor(private readonly queryBus: QueryBus) {}

  /**
   * Serves the avatar for the signed URL from the profile (no bearer token: `<img>` cannot send
   * one). The image behind a URL never changes, so the browser may keep it while the URL is valid.
   */
  @Get(':id/content')
  async content(
    @Param('id', ParseUUIDPipe) avatarId: string,
    @Query('token') token: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const avatar = await this.queryBus.execute(new GetAvatarContentQuery(avatarId, token));

    await new Promise<void>((resolve, reject) => {
      res.sendFile(
        avatar.path,
        {
          // A small image, always sent whole.
          acceptRanges: false,
          headers: {
            'Content-Type': avatar.mimeType,
            'X-Content-Type-Options': 'nosniff',
            'Cache-Control': `private, max-age=${AVATAR_LINK_WINDOW_SECONDS}`,
            // The URL carries a token: never leak it through Referer.
            'Referrer-Policy': 'no-referrer',
          },
        },
        (error?: Error & { status?: number }) => {
          if (!error || res.headersSent) {
            resolve();
          } else if (error.status === 412) {
            // A failed precondition is the client's mistake, not a missing avatar.
            res.status(412).end();
            resolve();
          } else {
            reject(new NotFoundException('Avatar not found'));
          }
        },
      );
    });
  }
}
