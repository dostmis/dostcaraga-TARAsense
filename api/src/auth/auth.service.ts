import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { AuditService } from '../audit/audit.service';
import { JwtPayload } from './interfaces/jwt-payload.interface';
import { Role } from '../common/enums/role.enum';

interface TokenPair {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly auditService: AuditService,
  ) {}

  async register(dto: RegisterDto, actor?: { sub: string; role: string }, meta?: { ip?: string; ua?: string | string[] }) {
    const email = dto.email.trim().toLowerCase();
    const existing = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });

    if (existing) {
      throw new ConflictException('Email already registered');
    }

    const requestedRole = dto.role ?? Role.CONSUMER;
    const role = this.resolveCreationRole(requestedRole, actor);

    const hashedPassword = await bcrypt.hash(dto.password, 12);
    const user = await this.prisma.user.create({
      data: {
        email,
        name: dto.name.trim(),
        password: hashedPassword,
        organization: dto.organization?.trim() || null,
        role: role as never,
      },
    });

    await this.auditService.log({
      action: 'AUTH_REGISTER',
      resource: 'user',
      actorId: actor?.sub ?? user.id,
      metadata: { createdUserId: user.id, role },
      ipAddress: meta?.ip,
      userAgent: meta?.ua,
    });

    const tokens = await this.issueTokens(user);
    return {
      user: this.publicUser(user),
      ...tokens,
    };
  }

  async login(dto: LoginDto, meta?: { ip?: string; ua?: string | string[] }) {
    const email = dto.email.trim().toLowerCase();

    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user?.password) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const validPassword = await bcrypt.compare(dto.password, user.password);
    if (!validPassword) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const tokens = await this.issueTokens(user);

    await this.auditService.log({
      action: 'AUTH_LOGIN',
      resource: 'session',
      actorId: user.id,
      metadata: { role: user.role },
      ipAddress: meta?.ip,
      userAgent: meta?.ua,
    });

    return {
      user: this.publicUser(user),
      ...tokens,
    };
  }

  async refresh(dto: RefreshTokenDto, meta?: { ip?: string; ua?: string | string[] }) {
    const payload = await this.verifyRefreshToken(dto.refreshToken);

    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) {
      throw new UnauthorizedException('User no longer exists');
    }

    const refreshTokens = await this.prisma.refreshToken.findMany({
      where: {
        userId: user.id,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { id: true, tokenHash: true },
      orderBy: { createdAt: 'desc' },
      take: 8,
    });

    let matchedTokenId: string | null = null;
    for (const item of refreshTokens) {
      const matched = await bcrypt.compare(dto.refreshToken, item.tokenHash);
      if (matched) {
        matchedTokenId = item.id;
        break;
      }
    }

    if (!matchedTokenId) {
      throw new UnauthorizedException('Refresh token is invalid or revoked');
    }

    await this.prisma.refreshToken.update({
      where: { id: matchedTokenId },
      data: { revokedAt: new Date() },
    });

    const tokens = await this.issueTokens(user);

    await this.auditService.log({
      action: 'AUTH_REFRESH',
      resource: 'session',
      actorId: user.id,
      metadata: { refreshedFromTokenId: matchedTokenId },
      ipAddress: meta?.ip,
      userAgent: meta?.ua,
    });

    return {
      user: this.publicUser(user),
      ...tokens,
    };
  }

  async logout(userId: string, refreshToken?: string, meta?: { ip?: string; ua?: string | string[] }) {
    if (!refreshToken) {
      await this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });

      await this.auditService.log({
        action: 'AUTH_LOGOUT_ALL',
        resource: 'session',
        actorId: userId,
        ipAddress: meta?.ip,
        userAgent: meta?.ua,
      });

      return { ok: true };
    }

    const tokens = await this.prisma.refreshToken.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true, tokenHash: true },
      orderBy: { createdAt: 'desc' },
      take: 8,
    });

    let revoked = false;
    for (const token of tokens) {
      const matched = await bcrypt.compare(refreshToken, token.tokenHash);
      if (!matched) {
        continue;
      }
      await this.prisma.refreshToken.update({
        where: { id: token.id },
        data: { revokedAt: new Date() },
      });
      revoked = true;
      break;
    }

    await this.auditService.log({
      action: 'AUTH_LOGOUT',
      resource: 'session',
      actorId: userId,
      metadata: { tokenRevoked: revoked },
      ipAddress: meta?.ip,
      userAgent: meta?.ua,
    });

    return { ok: true, tokenRevoked: revoked };
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return this.publicUser(user);
  }

  private resolveCreationRole(requested: Role, actor?: { sub: string; role: string }): Role {
    if (!actor) {
      return Role.CONSUMER;
    }

    if (actor.role === Role.ADMIN) {
      return requested;
    }

    if (requested !== Role.CONSUMER) {
      throw new BadRequestException('Only admin can assign elevated roles');
    }

    return Role.CONSUMER;
  }

  private async issueTokens(
    user: { id: string; email: string; role: string },
  ): Promise<TokenPair> {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };

    const accessToken = await this.jwtService.signAsync(payload, {
      secret: this.getRequiredEnv('JWT_ACCESS_SECRET'),
      expiresIn: (this.configService.get<string>('JWT_ACCESS_TTL') || '900s') as never,
    });

    const refreshToken = await this.jwtService.signAsync(payload, {
      secret: this.getRequiredEnv('JWT_REFRESH_SECRET'),
      expiresIn: (this.configService.get<string>('JWT_REFRESH_TTL') || '7d') as never,
    });

    const decodedRefresh = this.jwtService.decode(refreshToken) as { exp?: number } | null;
    const expiresAt = new Date((decodedRefresh?.exp ?? Math.floor(Date.now() / 1000) + 604800) * 1000);

    const tokenHash = await bcrypt.hash(refreshToken, 12);
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt,
      },
    });

    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
    };
  }

  private async verifyRefreshToken(token: string): Promise<JwtPayload> {
    try {
      return await this.jwtService.verifyAsync<JwtPayload>(token, {
        secret: this.getRequiredEnv('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Refresh token is invalid');
    }
  }

  private getRequiredEnv(key: string): string {
    const value = this.configService.get<string>(key);
    if (!value) {
      throw new Error(`${key} is not configured`);
    }
    return value;
  }

  private publicUser(user: {
    id: string;
    email: string;
    name: string;
    role: string;
    organization: string | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      organization: user.organization,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}
