import { Body, Controller, Post } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import type { AccessTokenResult } from './auth.types.js';
import { RegisterUserCommand } from './commands/index.js';
import { LoginDto, RegisterDto } from './dto/auth-credentials.dto.js';
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
}
