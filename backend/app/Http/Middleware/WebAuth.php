<?php

namespace App\Http\Middleware;

use App\Services\Auth\SessionTokenService;
use App\Enums\AppRole;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Authenticate web requests via session cookie.
 * Mirrors getCurrentSession() in src/lib/auth/session.ts.
 */
class WebAuth
{
    /**
     * Handle an incoming request.
     */
    public function handle(Request $request, Closure $next, string ...$roles): mixed
    {
        $token = $request->cookie(SessionTokenService::COOKIE_KEY, '');

        if (empty($token)) {
            abort(401, 'Unauthorized');
        }

        $verified = SessionTokenService::verify($token);

        if ($verified === null) {
            abort(401, 'Unauthorized');
        }

        $user = DB::table('User')
            ->select(['id', 'role'])
            ->where('id', '=', $verified['userId'])
            ->first();

        if ($user === null) {
            abort(401, 'Unauthorized');
        }

        $appRole = AppRole::parse($user->role);

        if ($appRole === null) {
            abort(401, 'Unauthorized');
        }

        if (!empty($roles) && !in_array($appRole->value, $roles, true)) {
            abort(403, 'Forbidden');
        }

        $request->merge([
            'authUserId' => $user->id,
            'authRole' => $appRole->value,
        ]);

        return $next($request);
    }
}
