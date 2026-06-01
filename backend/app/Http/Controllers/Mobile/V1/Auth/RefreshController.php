<?php

namespace App\Http\Controllers\Mobile\V1\Auth;

use App\Services\Auth\MobileTokenService;
use App\Services\MobileApiService;
use App\Services\RateLimitService;
use App\Enums\AppRole;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * POST /api/mobile/v1/auth/refresh
 * Mirrors src/app/api/mobile/v1/auth/refresh/route.ts
 */
class RefreshController
{
    public function __invoke(Request $request)
    {
        $ip = RateLimitService::getClientIp();
        $ipRate = RateLimitService::check("mobile-refresh:{$ip}", RateLimitService::REFRESH);

        if (!$ipRate['allowed']) {
            return MobileApiService::error(
                'Too many requests. Please try again later.',
                429,
                'RATE_LIMITED'
            );
        }

        $body = $request->json()->all() ?: [];
        $refreshToken = (string) ($body['refreshToken'] ?? '');
        $verified = MobileTokenService::verify($refreshToken, 'refresh');

        if ($verified === null) {
            return MobileApiService::error(
                'Refresh token is invalid or expired.',
                401,
                'INVALID_REFRESH_TOKEN'
            );
        }

        $userRate = RateLimitService::check(
            "mobile-refresh:{$verified['userId']}",
            RateLimitService::REFRESH
        );

        if (!$userRate['allowed']) {
            return MobileApiService::error(
                'Too many requests. Please try again later.',
                429,
                'RATE_LIMITED'
            );
        }

        $user = DB::table('User')
            ->select([
                'id', 'email', 'name', 'role', 'organization',
                'assignedRegion', 'assignedFacility', 'createdAt', 'updatedAt',
            ])
            ->where('id', '=', $verified['userId'])
            ->first();

        $role = AppRole::parse($user->role ?? '');

        if (!$user || !$role) {
            return MobileApiService::error('User no longer exists.', 401, 'UNAUTHORIZED');
        }

        return MobileApiService::authResponse((array) $user + ['role' => $role->value]);
    }
}
