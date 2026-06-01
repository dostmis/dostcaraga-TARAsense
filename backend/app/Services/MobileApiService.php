<?php

namespace App\Services;

use Illuminate\Http\JsonResponse;

/**
 * Mobile API response helpers.
 * Mirrors src/lib/mobile/api.ts exactly.
 */
class MobileApiService
{
    public static function json(mixed $data, int $status = 200, array $headers = []): JsonResponse
    {
        return response()->json($data, $status, array_merge([
            'Cache-Control' => 'no-store',
        ], $headers));
    }

    public static function error(string $message, int $status = 400, string $code = 'MOBILE_API_ERROR'): JsonResponse
    {
        return self::json([
            'error' => [
                'code' => $code,
                'message' => $message,
            ],
        ], $status);
    }

    /**
     * Format a response with both access and refresh tokens.
     * Mirrors mobileAuthResponse().
     */
    public static function authResponse(array $user): JsonResponse
    {
        $accessToken = \App\Services\Auth\MobileTokenService::createAccess($user['id']);
        $refreshToken = \App\Services\Auth\MobileTokenService::createRefresh($user['id']);

        return self::json([
            'user' => [
                'id' => $user['id'],
                'email' => $user['email'],
                'name' => $user['name'],
                'role' => $user['role'],
                'organization' => $user['organization'] ?? null,
                'assignedRegion' => $user['assignedRegion'] ?? null,
                'assignedFacility' => $user['assignedFacility'] ?? null,
                'createdAt' => self::toIso($user['createdAt'] ?? null),
                'updatedAt' => self::toIso($user['updatedAt'] ?? null),
            ],
            'accessToken' => $accessToken,
            'refreshToken' => $refreshToken,
            'tokenType' => 'Bearer',
        ]);
    }

    /**
     * Convert a value to ISO 8601 string. Handles DateTime, Carbon, and strings.
     */
    public static function toIso(mixed $value): ?string
    {
        if ($value === null) {
            return null;
        }

        if ($value instanceof \DateTimeInterface) {
            return $value->format('Y-m-d\TH:i:s.v\Z'); // Match JS .toISOString()
        }

        if (is_string($value)) {
            return $value;
        }

        return (string) $value;
    }

    /**
     * Format a user object for public mobile API responses.
     */
    public static function publicMobileUser(array $user): array
    {
        return [
            'id' => $user['id'],
            'email' => $user['email'],
            'name' => $user['name'],
            'role' => $user['role'],
            'organization' => $user['organization'] ?? null,
            'assignedRegion' => $user['assignedRegion'] ?? null,
            'assignedFacility' => $user['assignedFacility'] ?? null,
            'createdAt' => self::toIso($user['createdAt'] ?? null),
            'updatedAt' => self::toIso($user['updatedAt'] ?? null),
        ];
    }
}
