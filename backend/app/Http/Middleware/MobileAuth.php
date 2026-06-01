<?php

namespace App\Http\Middleware;

use App\Services\Auth\MobileTokenService;
use App\Services\MobileApiService;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use App\Enums\AppRole;

/**
 * Authenticate mobile API requests via Bearer token.
 * Mirrors requireMobileUser() in src/lib/mobile/api.ts.
 */
class MobileAuth
{
    /**
     * Handle an incoming request.
     *
     * @param  \Closure(\Illuminate\Http\Request): mixed  $next
     * @param  string[]  ...$roles
     */
    public function handle(Request $request, Closure $next, string ...$roles): mixed
    {
        $token = $this->readBearerToken($request);

        if ($token === null) {
            return MobileApiService::error('Missing bearer token.', 401, 'UNAUTHORIZED');
        }

        $verified = MobileTokenService::verify($token, 'access');

        if ($verified === null) {
            return MobileApiService::error('Invalid or expired bearer token.', 401, 'UNAUTHORIZED');
        }

        $user = DB::table('User')
            ->select([
                'id', 'email', 'name', 'role', 'organization',
                'assignedRegion', 'assignedFacility', 'createdAt', 'updatedAt',
            ])
            ->where('id', '=', $verified['userId'])
            ->first();

        if ($user === null) {
            return MobileApiService::error('User no longer exists.', 401, 'UNAUTHORIZED');
        }

        $appRole = AppRole::parse($user->role);

        if ($appRole === null) {
            return MobileApiService::error('User no longer exists.', 401, 'UNAUTHORIZED');
        }

        if (!empty($roles) && !in_array($appRole->value, $roles, true)) {
            return MobileApiService::error(
                'Your account is not allowed to access this resource.',
                403,
                'FORBIDDEN'
            );
        }

        // Attach user to request for downstream access.
        $request->merge(['authUser' => array_merge((array) $user, ['role' => $appRole->value])]);

        return $next($request);
    }

    private function readBearerToken(Request $request): ?string
    {
        $authorization = $request->header('authorization', '');

        if (empty($authorization)) {
            return null;
        }

        $parts = preg_split('/\s+/', $authorization, 2);

        if (count($parts) !== 2 || strtolower($parts[0]) !== 'bearer' || empty($parts[1])) {
            return null;
        }

        return $parts[1];
    }
}
