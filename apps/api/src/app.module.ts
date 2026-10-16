import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AuthModule } from './auth/auth.module.js';
import { MeetingsModule } from './meetings/meetings.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { UsersModule } from './users/users.module.js';

@Module({
  imports: [CqrsModule.forRoot(), PrismaModule, AuthModule, UsersModule, MeetingsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
