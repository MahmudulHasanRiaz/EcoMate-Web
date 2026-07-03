import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { FastifyRequest } from 'fastify';

@Injectable()
export class RefreshJwtStrategy extends PassportStrategy(
  Strategy,
  'jwt-refresh',
) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        (request: FastifyRequest) => {
          return request?.cookies?.['refreshToken'] || null;
        },
      ]),
      ignoreExpiration: false,
      secretOrKey: process.env['JWT_REFRESH_SECRET'] as string,
      passReqToCallback: true,
    });
  }

  async validate(req: FastifyRequest, payload: { sub: string; email: string }) {
    const refreshToken = req.cookies?.['refreshToken'];
    return { userId: payload.sub, email: payload.email, refreshToken };
  }
}
