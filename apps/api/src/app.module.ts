import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { AuthModule } from './auth/auth.module.js';
import { JobsModule } from './jobs/jobs.module.js';
import { MeetingFilesModule } from './meeting-files/meeting-files.module.js';
import { MeetingsModule } from './meetings/meetings.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { UsersModule } from './users/users.module.js';

@Module({
  imports: [
    CqrsModule.forRoot(),
    PrismaModule,
    JobsModule,
    AuthModule,
    UsersModule,
    MeetingsModule,
    MeetingFilesModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
