import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard.js';
import {
  AddParticipantCommand,
  CreateMeetingCommand,
  RemoveParticipantCommand,
} from './commands/index.js';
import { AddParticipantDto } from './dto/add-participant.dto.js';
import { CreateMeetingDto } from './dto/create-meeting.dto.js';
import type { MeetingView, ParticipantView } from './meetings.types.js';
import { GetMeetingQuery, ListMeetingsQuery, ListParticipantsQuery } from './queries/index.js';

@Controller('meetings')
@UseGuards(JwtAuthGuard)
export class MeetingsController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Post()
  create(
    @Req() { user }: AuthenticatedRequest,
    @Body() dto: CreateMeetingDto,
  ): Promise<MeetingView> {
    return this.commandBus.execute(
      new CreateMeetingCommand(user.id, dto.title, new Date(dto.startsAt)),
    );
  }

  @Get()
  list(@Req() { user }: AuthenticatedRequest): Promise<MeetingView[]> {
    return this.queryBus.execute(new ListMeetingsQuery(user.id));
  }

  @Get(':id')
  get(
    @Req() { user }: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<MeetingView> {
    return this.queryBus.execute(new GetMeetingQuery(user.id, id));
  }

  @Get(':id/participants')
  listParticipants(
    @Req() { user }: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ParticipantView[]> {
    return this.queryBus.execute(new ListParticipantsQuery(user.id, id));
  }

  @Post(':id/participants')
  addParticipant(
    @Req() { user }: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddParticipantDto,
  ): Promise<ParticipantView> {
    return this.commandBus.execute(new AddParticipantCommand(user.id, id, dto.email));
  }

  @Delete(':id/participants/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeParticipant(
    @Req() { user }: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) participantId: string,
  ): Promise<void> {
    return this.commandBus.execute(new RemoveParticipantCommand(user.id, id, participantId));
  }
}
