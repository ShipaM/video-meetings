import { Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnApplicationShutdown {
  constructor() {
    super({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  /**
   * The last shutdown phase: background jobs (stopped in `beforeApplicationShutdown`) may still
   * write their results until then.
   */
  async onApplicationShutdown(): Promise<void> {
    await this.$disconnect();
  }
}
