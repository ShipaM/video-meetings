import { Controller, Head, Patch, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { TusService } from './tus.service.js';

/**
 * tus endpoints: `POST /uploads` creates an upload, `HEAD /uploads/:id` reports the stored offset,
 * `PATCH /uploads/:id` appends a chunk. The bearer token is checked before tus sees the request.
 * tus `GET` (download) is deliberately not routed: files are only served through signed links.
 */
@Controller('uploads')
@UseGuards(JwtAuthGuard)
export class UploadsController {
  constructor(private readonly tus: TusService) {}

  @Post()
  create(@Req() req: Request, @Res() res: Response): Promise<void> {
    return this.tus.handle(req, res);
  }

  @Head(':id')
  offset(@Req() req: Request, @Res() res: Response): Promise<void> {
    return this.tus.handle(req, res);
  }

  @Patch(':id')
  append(@Req() req: Request, @Res() res: Response): Promise<void> {
    return this.tus.handle(req, res);
  }
}
