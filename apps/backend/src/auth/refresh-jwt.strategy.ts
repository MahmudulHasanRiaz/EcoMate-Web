import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Request } from 'express';

@Injectable()
export class RefreshJwtStrategy extends PassportStrategy(
  Strategy,
  'jwt-refresh',
) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        (request: Request) => {
          return request?.cookies?.['refreshToken'] || null;
        },
      ]),
      ignoreExpiration: false,
      secretOrKey:
        process.env['JWT_REFRESH_SECRET'] || 'eco-mate-refresh-secret',
      passReqToCallback: true,
    });
  }

  async validate(req: Request, payload: { sub: string; email: string }) {
    const refreshToken = req.cookies?.['refreshToken'];
    return { userId: payload.sub, email: payload.email, refreshToken };
  }
}
