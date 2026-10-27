import { Module, OnModuleInit } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { CommandHandlers } from './commands/index.js';
import { StorageModule } from '../storage/storage.module.js';
import { fileLinkSecret } from './meeting-files.config.js';
import { MeetingFilesController } from './meeting-files.controller.js';
import { ProcessingQueue } from './processing/processing-queue.js';
import { SummarizerProvider } from './processing/summarizer.provider.js';
import { TranscriberProvider } from './processing/transcriber.provider.js';
import { QueryHandlers } from './queries/index.js';
import { StorageMaintenanceWorker } from './storage-maintenance.worker.js';
import { TusService } from './tus.service.js';
import { UploadsController } from './uploads.controller.js';

@Module({
  imports: [AuthModule, StorageModule],
  controllers: [UploadsController, MeetingFilesController],
  providers: [
    TusService,
    SummarizerProvider,
    TranscriberProvider,
    ProcessingQueue,
    StorageMaintenanceWorker,
    ...CommandHandlers,
    ...QueryHandlers,
  ],
})
export class MeetingFilesModule implements OnModuleInit {
  onModuleInit(): void {
    // Fail at startup, not on the first download link.
    fileLinkSecret();
  }
}
