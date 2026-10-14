import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { AccessTokenResult } from './auth.types.js';

@Injectable()
export class TokenService {
  constructor(private readonly jwt: JwtService) {}

  async issue(userId: string, email: string): Promise<AccessTokenResult> {
    return { accessToken: await this.jwt.signAsync({ sub: userId, email }) };
  }
}
