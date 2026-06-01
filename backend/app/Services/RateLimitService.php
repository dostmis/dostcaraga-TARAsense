<?php

namespace App\Services;

use Illuminate\Support\Facades\Cache;

/**
 * Sliding-window rate limiter.
 * Mirrors src/lib/rate-limit.ts.
 *
 * Uses Laravel cache (file/redis/memcached depending on driver).
 * For multi-instance deployments, use a centralized cache driver (Redis).
 */
class RateLimitService
{
    public const AUTH = ['limit' => 10, 'windowMs' => 900000];      // 10 req / 15 min
    public const CHAT = ['limit' => 30, 'windowMs' => 60000];        // 30 req / 1 min
    public const REFRESH = ['limit' => 30, 'windowMs' => 900000];    // 30 req / 15 min
    public const MUTATION = ['limit' => 60, 'windowMs' => 60000];    // 60 req / 1 min
    public const SUBMIT = ['limit' => 20, 'windowMs' => 60000];      // 20 req / 1 min

    /**
     * Check if a request is allowed under the rate limit and increment the counter.
     */
    public static function check(string $key, array $config): array
    {
        $cacheKey = 'rate_limit:' . $key;
        $now = (int) (microtime(true) * 1000); // milliseconds
        $windowMs = $config['windowMs'];
        $limit = $config['limit'];

        $entry = Cache::get($cacheKey);

        if ($entry === null || ($now - $entry['windowStart']) >= $windowMs) {
            Cache::put($cacheKey, [
                'count' => 1,
                'windowStart' => $now,
            ], (int) ceil($windowMs / 1000) + 1);

            return [
                'allowed' => true,
                'remaining' => $limit - 1,
                'resetAt' => $now + $windowMs,
            ];
        }

        $entry['count'] += 1;
        Cache::put($cacheKey, $entry, (int) ceil($windowMs / 1000) + 1);

        $allowed = $entry['count'] <= $limit;

        return [
            'allowed' => $allowed,
            'remaining' => max(0, $limit - $entry['count']),
            'resetAt' => $entry['windowStart'] + $windowMs,
        ];
    }

    public static function getClientIp(): string
    {
        $forwarded = request()->header('x-forwarded-for');

        if ($forwarded) {
            $ips = explode(',', $forwarded);
            return trim($ips[0]);
        }

        return request()->ip() ?? 'unknown';
    }
}
