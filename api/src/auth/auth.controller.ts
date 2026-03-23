import {
  Body,
  Controller,
  Get,
  Ip,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  async register(
    @Body() dto: RegisterDto,
    @Ip() ip: string,
    @Req() request: Request,
  ) {
    return this.authService.register(dto, undefined, {
      ip,
      ua: request.headers['user-agent'],
    });
  }

  @Post('admin/register')
  @UseGuards(JwtAuthGuard)
  @Roles(Role.ADMIN)
  async adminRegister(
    @Body() dto: RegisterDto,
    @CurrentUser() actor: { sub: string; role: string } | null,
    @Ip() ip: string,
    @Req() request: Request,
  ) {
    if (!actor) {
      throw new UnauthorizedException('Missing actor');
    }

    return this.authService.register(dto, actor, {
      ip,
      ua: request.headers['user-agent'],
    });
  }

  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Ip() ip: string,
    @Req() request: Request,
  ) {
    return this.authService.login(dto, {
      ip,
      ua: request.headers['user-agent'],
    });
  }

  @Post('refresh')
  async refresh(
    @Body() dto: RefreshTokenDto,
    @Ip() ip: string,
    @Req() request: Request,
  ) {
    return this.authService.refresh(dto, {
      ip,
      ua: request.headers['user-agent'],
    });
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  async logout(
    @CurrentUser() user: { sub: string },
    @Body() dto: Partial<RefreshTokenDto>,
    @Ip() ip: string,
    @Req() request: Request,
  ) {
    return this.authService.logout(user.sub, dto.refreshToken, {
      ip,
      ua: request.headers['user-agent'],
    });
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async me(@CurrentUser() user: { sub: string }) {
    return this.authService.me(user.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Get('introspect')
  async introspect(@CurrentUser() user: { sub: string }) {
    const profile = await this.authService.me(user.sub);
    return {
      active: true,
      user: profile,
    };
  }
}
