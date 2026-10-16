import { UnauthorizedException } from '@nestjs/common';
import { IQueryHandler, QueryBus, QueryHandler } from '@nestjs/cqrs';
import { compare } from 'bcryptjs';
import { FindUserByEmailQuery } from '../../../users/index.js';
import type { AccessTokenResult } from '../../auth.types.js';
import { TokenService } from '../../token.service.js';
import { LoginQuery } from '../login.query.js';

@QueryHandler(LoginQuery)
export class LoginHandler implements IQueryHandler<LoginQuery> {
  constructor(
    private readonly queryBus: QueryBus,
    private readonly tokens: TokenService,
  ) {}

  async execute({ email, password }: LoginQuery): Promise<AccessTokenResult> {
    const user = await this.queryBus.execute(new FindUserByEmailQuery(email));

    if (!user || !(await compare(password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid e-mail or password');
    }

    return this.tokens.issue(user.id, user.email);
  }
}
