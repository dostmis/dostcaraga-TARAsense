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
 * POST /api/mobile/v1/auth/register
 * Mirrors src/app/api/mobile/v1/auth/register/route.ts
 */
class RegisterController
{
    public function __invoke(Request $request)
    {
        if (!MobileTokenService::isConfigured()) {
            return MobileApiService::error('Mobile authentication is not configured.', 500, 'AUTH_CONFIG_ERROR');
        }

        $ip = RateLimitService::getClientIp();
        $rate = RateLimitService::check("mobile-register:{$ip}", RateLimitService::AUTH);

        if (!$rate['allowed']) {
            return MobileApiService::error(
                'Too many registration attempts. Please try again later.',
                429,
                'RATE_LIMITED'
            );
        }

        $body = $request->json()->all() ?: [];
        $name = trim((string) ($body['name'] ?? ''));
        $email = strtolower(trim((string) ($body['email'] ?? '')));
        $password = (string) ($body['password'] ?? '');
        $organization = trim((string) ($body['organization'] ?? ''));

        if (mb_strlen($name) < 2) {
            return MobileApiService::error('Name must be at least 2 characters.', 400, 'VALIDATION_ERROR');
        }

        if (!preg_match('/^[^\s@]+@[^\s@]+\.[^\s@]+$/', $email)) {
            return MobileApiService::error('Enter a valid email address.', 400, 'VALIDATION_ERROR');
        }

        if (strlen($password) < 8) {
            return MobileApiService::error('Password must be at least 8 characters.', 400, 'VALIDATION_ERROR');
        }

        $existing = DB::table('User')
            ->where('email', '=', $email)
            ->exists();

        if ($existing) {
            return MobileApiService::error('Email already registered.', 409, 'EMAIL_EXISTS');
        }

        $hashedPassword = PasswordService::hash($password);

        $userId = \App\Support\Cuid::make();

        DB::table('User')->insert([
            'id' => $userId,
            'name' => $name,
            'email' => $email,
            'password' => $hashedPassword,
            'role' => 'CONSUMER',
            'organization' => $organization ?: null,
            'createdAt' => now(),
            'updatedAt' => now(),
        ]);

        $user = DB::table('User')
            ->select([
                'id', 'email', 'name', 'role', 'organization',
                'assignedRegion', 'assignedFacility', 'createdAt', 'updatedAt',
            ])
            ->where('id', '=', $userId)
            ->first();

        $role = AppRole::parse($user->role);

        UserUsageService::log([
            'actorUserId' => $userId,
            'actorName' => $user->name,
            'actorEmail' => $user->email,
            'actorRole' => $role->value,
            'action' => 'USER_REGISTERED',
            'entityType' => 'User',
            'entityId' => $userId,
            'summary' => "{$user->name} registered a new mobile account.",
            'metadata' => [
                'channel' => 'mobile',
                'role' => $role->value,
                'organization' => $user->organization,
            ],
        ]);

        return MobileApiService::authResponse((array) $user + ['role' => $role->value]);
    }
}
