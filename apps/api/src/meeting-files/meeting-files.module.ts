import { Module, OnModuleInit } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { CommandHandlers } from './commands/index.js';
import { FilesStorageService } from './files-storage.service.js';
import { fileLinkSecret } from './meeting-files.config.js';
import { MeetingFilesController } from './meeting-files.controller.js';
import { QueryHandlers } from './queries/index.js';
import { TusService } from './tus.service.js';
import { UploadsController } from './uploads.controller.js';

@Module({
  imports: [AuthModule],
  controllers: [UploadsController, MeetingFilesController],
  providers: [FilesStorageService, TusService, ...CommandHandlers, ...QueryHandlers],
})
export class MeetingFilesModule implements OnModuleInit {
  onModuleInit(): void {
    // Fail at startup, not on the first download link.
    fileLinkSecret();
  }
}
