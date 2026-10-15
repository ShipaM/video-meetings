import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { CommandHandlers } from './commands/index.js';
import { MeetingsController } from './meetings.controller.js';
import { QueryHandlers } from './queries/index.js';

@Module({
  imports: [AuthModule],
  controllers: [MeetingsController],
  providers: [...CommandHandlers, ...QueryHandlers],
})
export class MeetingsModule {}
