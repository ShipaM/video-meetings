import { Module } from '@nestjs/common';
import { FilesStorageService } from './files-storage.service.js';

/** The files on disk (`FILES_DIR`), shared by every module that stores uploads. */
@Module({
  providers: [FilesStorageService],
  exports: [FilesStorageService],
})
export class StorageModule {}
