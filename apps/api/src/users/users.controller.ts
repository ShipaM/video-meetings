import { Body, Controller, Get, Patch, Req, UseGuards } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard.js';
import { UpdateProfileCommand } from './commands/index.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';
import { GetProfileQuery } from './queries/index.js';
import type { UserProfile } from './users.types.js';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get('me')
  getProfile(@Req() { user }: AuthenticatedRequest): Promise<UserProfile> {
    return this.queryBus.execute(new GetProfileQuery(user.id));
  }

  @Patch('me')
  updateProfile(
    @Req() { user }: AuthenticatedRequest,
    @Body() dto: UpdateProfileDto,
  ): Promise<UserProfile> {
    return this.commandBus.execute(new UpdateProfileCommand(user.id, dto.name));
  }
}
