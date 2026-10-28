import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { AvatarsController } from './avatars.controller.js';
import { CommandHandlers } from './commands/index.js';
import { QueryHandlers } from './queries/index.js';
import { UsersController } from './users.controller.js';

@Module({
  // AuthModule for JwtAuthGuard and JwtService (avatar links); Auth talks to Users through the
  // buses, never the other way. StorageModule for the avatar files.
  imports: [AuthModule, StorageModule],
  controllers: [UsersController, AvatarsController],
  providers: [...CommandHandlers, ...QueryHandlers],
})
export class UsersModule {}
