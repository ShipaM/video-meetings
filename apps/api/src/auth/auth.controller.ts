import { Body, Controller, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import type { AccessTokenResult } from './auth.types.js';
import { ChangePasswordCommand, RegisterUserCommand } from './commands/index.js';
import { ChangePasswordDto, LoginDto, RegisterDto } from './dto/auth-credentials.dto.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import type { AuthenticatedRequest } from './jwt-auth.guard.js';
import { LoginQuery } from './queries/index.js';

@Controller('auth')
export class AuthController {
  // constructor(private readonly auth: AuthService) {}
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Post('register')
  er(@Body() dto: RegisterDto): Promise<AccessTokenResult> {
    return this.commandBus.execute(new RegisterUserCommand(dto.email, dto.password));
  }

  // register(@Body() dto: RegisterDto) {
  //   return this.auth.register(dto);
  // }

  @Post('login')
  login(@Body() dto: LoginDto): Promise<AccessTokenResult> {
    return this.queryBus.execute(new LoginQuery(dto.email, dto.password));
  }

  // login(@Body() dto: LoginDto) {
  //   return this.auth.login(dto);
  // }

  @Post('password')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  changePassword(
    @Req() { user }: AuthenticatedRequest,
    @Body() dto: ChangePasswordDto,
  ): Promise<void> {
    return this.commandBus.execute(
      new ChangePasswordCommand(user.id, dto.oldPassword, dto.newPassword),
    );
  }
}
