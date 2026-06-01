<?php

namespace App\Http\Controllers\Mobile\V1\Auth;

use App\Services\MobileApiService;
use Illuminate\Http\Request;

/**
 * POST /api/mobile/v1/auth/logout
 * Mirrors src/app/api/mobile/v1/auth/logout/route.ts
 */
class LogoutController
{
    public function __invoke(Request $request)
    {
        return MobileApiService::json(['ok' => true]);
    }
}
