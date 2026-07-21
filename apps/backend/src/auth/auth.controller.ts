import {
  Controller,
  Post,
  Get,
  Put,
  Body,
  Res,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { RefreshJwtGuard } from './refresh-jwt.guard';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RateLimitPolicy } from '../common/rate-limit/rate-limit-policy.decorator';
import { SecurityService } from '../security/security.service';
import { getAllPermissions } from '../common/permissions/registry';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly security: SecurityService,
  ) {}

  @Public()
  @RateLimitPolicy('auth')
  @Post('register')
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    const result = await this.authService.register(dto);
    res.cookie('refreshToken', result.refreshToken, {
      httpOnly: true,
      secure: process.env['NODE_ENV'] === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/api/auth/',
    });
    return { accessToken: result.accessToken, user: result.user };
  }

  @Public()
  @RateLimitPolicy('auth')
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: FastifyReply,
    @Req() req: any,
  ) {
    try {
      const result = await this.authService.login(dto);
      res.cookie('refreshToken', result.refreshToken, {
        httpOnly: true,
        secure: process.env['NODE_ENV'] === 'production',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000,
        path: '/api/auth/',
      });
      return { accessToken: result.accessToken, user: result.user };
    } catch (error) {
      const ip = req?.ip || '';
      if (ip) this.security.recordFailedLogin(ip);
      throw error;
    }
  }

  @RateLimitPolicy('auth')
  @Public()
  @UseGuards(RefreshJwtGuard)
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @CurrentUser() user: { userId: string; refreshToken: string },
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    const result = await this.authService.refresh(
      user.userId,
      user.refreshToken,
    );
    res.cookie('refreshToken', result.refreshToken, {
      httpOnly: true,
      secure: process.env['NODE_ENV'] === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/api/auth/',
    });
    return { accessToken: result.accessToken, user: result.user };
  }

  @RateLimitPolicy('auth')
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @CurrentUser() user: { userId: string },
    @Res({ passthrough: true }) res: FastifyReply,
    @Req() req: any,
    @Body() body?: { logoutAllDevices?: boolean },
  ) {
    const refreshToken = req.cookies?.['refreshToken'];
    await this.authService.logout(user.userId, refreshToken, body?.logoutAllDevices);
    res.clearCookie('refreshToken', { path: '/api/auth/', sameSite: 'lax' });
    return { message: 'Logged out successfully' };
  }

  @RateLimitPolicy('auth')
  @Get('me')
  async me(@CurrentUser() user: any) {
    const profile = await this.authService.me(user.userId);
    // Include permissions from BA customSession (available on BA path)
    // or compute from role for JWT path
    let permissions = user.permissions;
    if (!permissions || !Array.isArray(permissions)) {
      if (user.role === 'superadmin' || user.role === 'admin') {
        permissions = getAllPermissions();
      } else {
        permissions = [];
      }
    }
    return { ...profile, permissions };
  }

  @RateLimitPolicy('auth')
  @Put('me')
  @HttpCode(HttpStatus.OK)
  async updateProfile(
    @CurrentUser() user: { userId: string },
    @Body() dto: UpdateProfileDto,
  ) {
    return this.authService.updateProfile(user.userId, dto);
  }

  @RateLimitPolicy('auth')
  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @CurrentUser() user: { userId: string },
    @Body() dto: ChangePasswordDto,
  ) {
    return this.authService.changePassword(user.userId, dto);
  }

  @Public()
  @RateLimitPolicy('auth')
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto.email);
  }

  @Public()
  @RateLimitPolicy('auth')
  @Post('verify-otp')
  @HttpCode(HttpStatus.OK)
  async verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.authService.verifyOtp(dto.email, dto.otp);
  }

  @Public()
  @RateLimitPolicy('auth')
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto.token, dto.password);
  }

  @Public()
  @RateLimitPolicy('auth')
  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  async verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.authService.verifyEmail(dto.token);
  }
}
