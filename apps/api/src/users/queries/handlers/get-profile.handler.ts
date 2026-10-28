import { NotFoundException } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { fileLinkSecret } from '../../../storage/storage.config.js';
import {
  AVATAR_LINK_AUDIENCE,
  AVATAR_LINK_TTL_SECONDS,
  avatarLinkIssuedAt,
} from '../../users.config.js';
import type { AvatarLinkPayload, UserProfile } from '../../users.types.js';
import { GetProfileQuery } from '../get-profile.query.js';

@QueryHandler(GetProfileQuery)
export class GetProfileHandler implements IQueryHandler<GetProfileQuery> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async execute({ userId }: GetProfileQuery): Promise<UserProfile> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, name: true, avatarId: true },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const { avatarId, ...profile } = user;
    return { ...profile, avatar: avatarId ? await this.avatarUrl(userId, avatarId) : null };
  }

  private async avatarUrl(userId: string, avatarId: string): Promise<string> {
    // `iat` rounded down to the window start (`exp` follows from it): the token, and so the URL,
    // is the same for every load within a window.
    const payload: AvatarLinkPayload & { iat: number } = {
      sub: userId,
      avatarId,
      iat: avatarLinkIssuedAt(Date.now()),
    };
    const token = await this.jwt.signAsync(payload, {
      secret: fileLinkSecret(),
      audience: AVATAR_LINK_AUDIENCE,
      expiresIn: AVATAR_LINK_TTL_SECONDS,
    });
    return `/avatars/${avatarId}/content?token=${encodeURIComponent(token)}`;
  }
}
