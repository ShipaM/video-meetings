import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { CommandHandlers } from './commands/index.js';
import { QueryHandlers } from './queries/index.js';
import { UsersController } from './users.controller.js';

@Module({
  // AuthModule only for JwtAuthGuard; Auth talks to Users through the buses, never the other way.
  imports: [AuthModule],
  controllers: [UsersController],
  providers: [...CommandHandlers, ...QueryHandlers],
})
export class UsersModule {}
