import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { ROLE_ALIASES, Role } from '../enums/role.enum';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{ user?: { role?: Role } }>();
    const actualRole = request.user?.role;

    if (!actualRole) {
      throw new ForbiddenException('Role not found in token');
    }

    const matched = requiredRoles.some((role) => {
      const acceptedRoles = ROLE_ALIASES[role] ?? [role];
      return acceptedRoles.includes(actualRole);
    });

    if (!matched) {
      throw new ForbiddenException('Insufficient role permissions');
    }

    return true;
  }
}
