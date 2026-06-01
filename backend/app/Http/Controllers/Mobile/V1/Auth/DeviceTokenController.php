<?php

namespace App\Http\Controllers\Mobile\V1\Auth;

use App\Services\MobileApiService;
use App\Services\RateLimitService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * POST /api/mobile/v1/auth/device-token
 * POST /api/mobile/v1/auth/device-token/remove
 * Mirrors src/app/api/mobile/v1/auth/device-token/ route files.
 */
class DeviceTokenController
{
    private const ALLOWED_PLATFORMS = ['android', 'ios', 'web'];
    private const MAX_TOKEN_LENGTH = 4096;

    /**
     * POST /api/mobile/v1/auth/device-token
     */
    public function store(Request $request)
    {
        $user = $request->get('authUser');

        $rate = RateLimitService::check(
            "mobile-device-token:{$user['id']}",
            RateLimitService::MUTATION
        );

        if (!$rate['allowed']) {
            return MobileApiService::error(
                'Too many requests. Please try again later.',
                429,
                'RATE_LIMITED'
            );
        }

        $body = $request->json()->all() ?: [];
        $token = trim((string) ($body['token'] ?? ''));
        $platform = strtolower(trim((string) ($body['platform'] ?? '')));

        if (empty($token) || strlen($token) > self::MAX_TOKEN_LENGTH) {
            return MobileApiService::error('A valid FCM token is required.', 400, 'VALIDATION_ERROR');
        }

        if (!in_array($platform, self::ALLOWED_PLATFORMS, true)) {
            return MobileApiService::error('platform must be one of: android, ios, web.', 400, 'VALIDATION_ERROR');
        }

        $existing = DB::table('DeviceToken')->where('token', '=', $token)->first();

        if ($existing) {
            DB::table('DeviceToken')
                ->where('token', '=', $token)
                ->update([
                    'userId' => $user['id'],
                    'platform' => $platform,
                    'updatedAt' => now(),
                ]);

            $record = DB::table('DeviceToken')->where('token', '=', $token)->first();
        } else {
            DB::table('DeviceToken')->insert([
                'id' => \App\Support\Cuid::make(),
                'userId' => $user['id'],
                'token' => $token,
                'platform' => $platform,
                'createdAt' => now(),
                'updatedAt' => now(),
            ]);

            $record = DB::table('DeviceToken')->where('token', '=', $token)->first();
        }

        return MobileApiService::json([
            'ok' => true,
            'deviceToken' => [
                'id' => $record->id,
                'platform' => $record->platform,
                'updatedAt' => MobileApiService::toIso($record->updatedAt),
            ],
        ]);
    }

    /**
     * POST /api/mobile/v1/auth/device-token/remove
     */
    public function remove(Request $request)
    {
        $user = $request->get('authUser');

        $rate = RateLimitService::check(
            "mobile-device-token-remove:{$user['id']}",
            RateLimitService::MUTATION
        );

        if (!$rate['allowed']) {
            return MobileApiService::error(
                'Too many requests. Please try again later.',
                429,
                'RATE_LIMITED'
            );
        }

        $body = $request->json()->all() ?: [];
        $token = trim((string) ($body['token'] ?? ''));

        if (!empty($token)) {
            DB::table('DeviceToken')
                ->where('token', '=', $token)
                ->where('userId', '=', $user['id'])
                ->delete();
        }

        return MobileApiService::json(['ok' => true]);
    }
}
