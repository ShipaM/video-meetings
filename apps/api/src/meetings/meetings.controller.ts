import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard.js';
import type { Meeting } from '../generated/prisma/client.js';
import { CreateMeetingCommand } from './commands/index.js';
import { CreateMeetingDto } from './dto/create-meeting.dto.js';
import { GetMeetingQuery, ListMeetingsQuery } from './queries/index.js';

@Controller('meetings')
@UseGuards(JwtAuthGuard)
export class MeetingsController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Post()
  create(@Req() { user }: AuthenticatedRequest, @Body() dto: CreateMeetingDto): Promise<Meeting> {
    return this.commandBus.execute(
      new CreateMeetingCommand(user.id, dto.title, new Date(dto.startsAt)),
    );
  }

  @Get()
  list(@Req() { user }: AuthenticatedRequest): Promise<Meeting[]> {
    return this.queryBus.execute(new ListMeetingsQuery(user.id));
  }

  @Get(':id')
  get(
    @Req() { user }: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Meeting> {
    return this.queryBus.execute(new GetMeetingQuery(user.id, id));
  }
}
