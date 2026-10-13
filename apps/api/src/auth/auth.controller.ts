import { Body, Controller, Post } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { LoginDto, RegisterDto } from './dto/auth-credentials.dto.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }
}
