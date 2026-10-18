import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { CommandHandlers } from './commands/index.js';
import { FilesStorageService } from './files-storage.service.js';
import { MeetingFilesController } from './meeting-files.controller.js';
import { QueryHandlers } from './queries/index.js';
import { TusService } from './tus.service.js';
import { UploadsController } from './uploads.controller.js';

@Module({
  imports: [AuthModule],
  controllers: [UploadsController, MeetingFilesController],
  providers: [FilesStorageService, TusService, ...CommandHandlers, ...QueryHandlers],
})
export class MeetingFilesModule {}
