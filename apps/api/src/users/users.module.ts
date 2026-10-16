import { Module } from '@nestjs/common';
import { CommandHandlers } from './commands/index.js';
import { QueryHandlers } from './queries/index.js';

@Module({
  providers: [...CommandHandlers, ...QueryHandlers],
})
export class UsersModule {}
