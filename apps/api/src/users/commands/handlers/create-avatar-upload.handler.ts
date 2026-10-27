import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { MAX_AVATAR_SIZE, resolveAvatarType } from '../../avatar-types.js';
import { CreateAvatarUploadCommand } from '../create-avatar-upload.command.js';

@CommandHandler(CreateAvatarUploadCommand)
export class CreateAvatarUploadHandler implements ICommandHandler<CreateAvatarUploadCommand> {
  constructor(private readonly prisma: PrismaService) {}

  async execute({ userId, uploadId, size, metadata }: CreateAvatarUploadCommand): Promise<void> {
    if (size > MAX_AVATAR_SIZE) {
      throw new PayloadTooLargeException('Avatar is larger than 5 MB');
    }

    // Keep only the last path segment of whatever the client sent.
    const name = metadata.filename?.split(/[\\/]/).pop()?.trim() ?? '';
    const mimeType = name ? resolveAvatarType(name, metadata.filetype ?? '') : null;
    if (!mimeType) {
      throw new BadRequestException('Avatar must be a PNG, JPEG or WebP image');
    }

    // The upload id is also the storage key.
    await this.prisma.userAvatar.create({ data: { id: uploadId, userId, mimeType, size } });
  }
}
