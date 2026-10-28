import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { FilesStorageService } from '../../../storage/files-storage.service.js';
import { fileLinkSecret } from '../../../storage/storage.config.js';
import { AVATAR_LINK_AUDIENCE } from '../../users.config.js';
import type { AvatarContent, AvatarLinkPayload } from '../../users.types.js';
import { GetAvatarContentQuery } from '../get-avatar-content.query.js';

@QueryHandler(GetAvatarContentQuery)
export class GetAvatarContentHandler implements IQueryHandler<GetAvatarContentQuery> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly storage: FilesStorageService,
  ) {}

  async execute({ avatarId, token }: GetAvatarContentQuery): Promise<AvatarContent> {
    const payload = await this.verify(token);
    if (payload?.avatarId !== avatarId) {
      throw new UnauthorizedException('Invalid or expired link');
    }

    // The link outlives a replaced or removed avatar, so it must still be the user's current one.
    const avatar = await this.prisma.userAvatar.findFirst({
      where: { id: avatarId, currentOf: { id: payload.sub } },
      select: { mimeType: true },
    });
    if (!avatar) {
      throw new NotFoundException('Avatar not found');
    }

    return { path: this.storage.pathOf(avatarId), mimeType: avatar.mimeType };
  }

  private async verify(token: string | undefined): Promise<AvatarLinkPayload | null> {
    if (!token) {
      return null;
    }
    // Outside the `try`: a missing secret is a server error, not a bad link.
    const secret = fileLinkSecret();
    try {
      return await this.jwt.verifyAsync<AvatarLinkPayload>(token, {
        secret,
        audience: AVATAR_LINK_AUDIENCE,
      });
    } catch {
      return null;
    }
  }
}
