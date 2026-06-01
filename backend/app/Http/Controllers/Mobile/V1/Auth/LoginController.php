<?php

namespace App\Http\Controllers\Mobile\V1\Auth;

use App\Services\Auth\MobileTokenService;
use App\Services\Auth\PasswordService;
use App\Services\MobileApiService;
use App\Services\RateLimitService;
use App\Services\UserUsageService;
use App\Enums\AppRole;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * POST /api/mobile/v1/auth/login
 * Mirrors src/app/api/mobile/v1/auth/login/route.ts
 */
class LoginController
{
    public function __invoke(Request $request)
    {
        if (!MobileTokenService::isConfigured()) {
            return MobileApiService::error('Mobile authentication is not configured.', 500, 'AUTH_CONFIG_ERROR');
        }

        $ip = RateLimitService::getClientIp();
        $rate = RateLimitService::check("mobile-login:{$ip}", RateLimitService::AUTH);

        if (!$rate['allowed']) {
            return MobileApiService::error(
                'Too many login attempts. Please try again later.',
                429,
                'RATE_LIMITED'
            );
        }

        $body = $request->json()->all() ?: [];
        $email = strtolower(trim((string) ($body['email'] ?? '')));
        $password = (string) ($body['password'] ?? '');

        if (empty($email) || empty($password)) {
            return MobileApiService::error('Email and password are required.', 400, 'VALIDATION_ERROR');
        }

        $user = DB::table('User')
            ->select([
                'id', 'email', 'name', 'password', 'role', 'organization',
                'assignedRegion', 'assignedFacility', 'createdAt', 'updatedAt',
            ])
            ->where('email', '=', $email)
            ->first();

        $role = AppRole::parse($user->role ?? '');

        if (
            !$user ||
            empty($user->password) ||
            !$role ||
            !PasswordService::verify($password, $user->password)
        ) {
            return MobileApiService::error('Invalid email or password.', 401, 'INVALID_CREDENTIALS');
        }

        UserUsageService::log([
            'actorUserId' => $user->id,
            'actorName' => $user->name,
            'actorEmail' => $user->email,
            'actorRole' => $role->value,
            'action' => 'LOGIN',
            'entityType' => 'User',
            'entityId' => $user->id,
            'summary' => 'User logged in from mobile.',
            'metadata' => ['channel' => 'mobile', 'role' => $role->value],
        ]);

        return MobileApiService::authResponse((array) $user + ['role' => $role->value]);
    }
}
