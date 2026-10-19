import { Global, Module } from '@nestjs/common';
import { JobsService } from './jobs.service.js';

/** Background jobs (pg-boss) for every module; queues and workers live with their module. */
@Global()
@Module({
  providers: [JobsService],
  exports: [JobsService],
})
export class JobsModule {}
