import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { compare, hash } from 'bcryptjs';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { LoginDto, RegisterDto } from './dto/auth-credentials.dto.js';

const BCRYPT_ROUNDS = 10;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async register({ email, password }: RegisterDto) {
    const normalized = email.toLowerCase();
    try {
      const user = await this.prisma.user.create({
        data: { email: normalized, passwordHash: await hash(password, BCRYPT_ROUNDS) },
      });
      return this.issueToken(user.id, user.email);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('User with this e-mail already exists');
      }
      throw error;
    }
  }

  async login({ email, password }: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user || !(await compare(password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid e-mail or password');
    }
    return this.issueToken(user.id, user.email);
  }

  private async issueToken(userId: string, email: string) {
    return { accessToken: await this.jwt.signAsync({ sub: userId, email }) };
  }
}
