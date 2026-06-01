<?php

namespace App\Http\Controllers\Mobile\V1\Auth;

use App\Services\MobileApiService;
use Illuminate\Http\Request;

/**
 * GET /api/mobile/v1/auth/me
 * Mirrors src/app/api/mobile/v1/auth/me/route.ts
 */
class MeController
{
    public function __invoke(Request $request)
    {
        $user = $request->get('authUser');

        return MobileApiService::json(MobileApiService::publicMobileUser($user));
    }
}
