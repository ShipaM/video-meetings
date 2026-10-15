import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller.js';
import { CommandHandlers } from './commands/index.js';
import { QueryHandlers } from './queries/index.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { TokenService } from './token.service.js';

@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: () => ({
        secret: process.env.JWT_SECRET,
        signOptions: { expiresIn: (process.env.JWT_EXPIRES_IN ?? '7d') as '7d' },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [TokenService, JwtAuthGuard, ...CommandHandlers, ...QueryHandlers],
  exports: [JwtModule, JwtAuthGuard],
})
export class AuthModule {}
