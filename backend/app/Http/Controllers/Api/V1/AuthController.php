<?php

namespace App\Http\Controllers\Api\V1;

use App\Services\ApiResponseService;
use App\Services\Auth\SessionTokenService;
use App\Services\Auth\WebAuthService;
use App\Services\RateLimitService;
use Illuminate\Http\Request;

class AuthController
{
    public function login(Request $request, WebAuthService $service)
    {
        $rate = RateLimitService::check('web-login:' . RateLimitService::getClientIp(), RateLimitService::AUTH);
        if (!$rate['allowed']) {
            return ApiResponseService::error('Too many login attempts. Please try again later.', 429, 'RATE_LIMITED');
        }

        $email = (string) $request->input('email', '');
        $password = (string) $request->input('password', '');

        if ($email === '' || $password === '') {
            return ApiResponseService::error('Email and password are required.', 400, 'VALIDATION_ERROR');
        }

        $result = $service->authenticate($email, $password);
        if (($result['ok'] ?? false) !== true) {
            return ApiResponseService::error($result['error'], $result['status'], $result['code']);
        }

        return ApiResponseService::json(['user' => $result['user']])
            ->cookie(
                SessionTokenService::COOKIE_KEY,
                $result['token'],
                60 * 24 * 7,
                '/',
                null,
                app()->environment('production'),
                true,
                false,
                'Lax'
            );
    }

    public function me(Request $request, WebAuthService $service)
    {
        $user = $service->currentUser($request->cookie(SessionTokenService::COOKIE_KEY));

        if (!$user) {
            return ApiResponseService::error('Unauthorized', 401, 'UNAUTHORIZED');
        }

        return ApiResponseService::json(['user' => $user]);
    }

    public function logout()
    {
        return ApiResponseService::json(['ok' => true])
            ->withoutCookie(SessionTokenService::COOKIE_KEY, '/');
    }
}
