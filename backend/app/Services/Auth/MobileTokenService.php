<?php

namespace App\Services\Auth;

/**
 * HMAC-SHA256 mobile token service.
 * Mirrors src/lib/mobile/token.ts exactly.
 *
 * Token format: {base64url_payload}.{base64url_hmac_signature}
 * Access token TTL: 24 hours (86400 seconds)
 * Refresh token TTL: 30 days (2592000 seconds)
 */
class MobileTokenService
{
    private const ACCESS_TTL_SECONDS = 86400;
    private const REFRESH_TTL_SECONDS = 2592000;
    private const MIN_SECRET_LENGTH = 32;

    public static function createAccess(string $userId, ?\DateTimeInterface $now = null): string
    {
        return self::create($userId, 'access', $now);
    }

    public static function createRefresh(string $userId, ?\DateTimeInterface $now = null): string
    {
        return self::create($userId, 'refresh', $now);
    }

    /**
     * Verify a mobile token of the expected type. Returns userId and expiresAt, or null.
     */
    public static function verify(string $token, string $expectedType): ?array
    {
        if (empty($token)) {
            return null;
        }

        $parts = explode('.', $token, 2);

        if (count($parts) !== 2) {
            return null;
        }

        [$payloadBase64, $signature] = $parts;

        if (empty($payloadBase64) || empty($signature)) {
            return null;
        }

        $secret = self::readSecret();

        if ($secret === null) {
            return null;
        }

        $expectedSignature = SessionTokenService::base64urlEncode(hash_hmac('sha256', $payloadBase64, $secret, true));

        if (!hash_equals($expectedSignature, $signature)) {
            return null;
        }

        $payloadJson = SessionTokenService::base64urlDecode($payloadBase64);

        if ($payloadJson === null) {
            return null;
        }

        $payload = json_decode($payloadJson, true);

        if (!is_array($payload)) {
            return null;
        }

        if (
            !isset($payload['uid'], $payload['typ'], $payload['iat'], $payload['exp']) ||
            !is_string($payload['uid']) ||
            strlen($payload['uid']) === 0 ||
            $payload['typ'] !== $expectedType ||
            !is_int($payload['iat']) ||
            !is_int($payload['exp'])
        ) {
            return null;
        }

        $nowSeconds = (int) (new \DateTimeImmutable())->format('U');

        if ($payload['exp'] <= $nowSeconds) {
            return null;
        }

        return [
            'userId' => $payload['uid'],
            'expiresAt' => new \DateTimeImmutable('@' . $payload['exp']),
        ];
    }

    public static function refreshAccess(string $refreshToken): ?string
    {
        $verified = self::verify($refreshToken, 'refresh');

        if ($verified === null) {
            return null;
        }

        return self::createAccess($verified['userId']);
    }

    public static function isConfigured(): bool
    {
        return self::readSecret() !== null;
    }

    private static function create(string $userId, string $type, ?\DateTimeInterface $now = null): string
    {
        $now = $now ?? new \DateTimeImmutable();
        $issuedAt = (int) $now->format('U');
        $ttl = $type === 'access' ? self::ACCESS_TTL_SECONDS : self::REFRESH_TTL_SECONDS;

        $payload = [
            'uid' => $userId,
            'typ' => $type,
            'iat' => $issuedAt,
            'exp' => $issuedAt + $ttl,
        ];

        $payloadBase64 = SessionTokenService::base64urlEncode(json_encode($payload));
        $secret = self::getSecret();
        $signature = SessionTokenService::base64urlEncode(hash_hmac('sha256', $payloadBase64, $secret, true));

        return "{$payloadBase64}.{$signature}";
    }

    private static function getSecret(): string
    {
        $secret = self::readSecret();

        if ($secret === null) {
            throw new \RuntimeException(
                'MOBILE_TOKEN_SECRET (or SESSION_SECRET) must be set and at least ' .
                self::MIN_SECRET_LENGTH . ' characters long.'
            );
        }

        return $secret;
    }

    private static function readSecret(): ?string
    {
        // Prefer dedicated secret for independent signing keys.
        $dedicated = env('MOBILE_TOKEN_SECRET', '');

        if (strlen($dedicated) >= self::MIN_SECRET_LENGTH) {
            return $dedicated;
        }

        // Fall back to SESSION_SECRET.
        $fallback = env('SESSION_SECRET', '');

        if (strlen($fallback) >= self::MIN_SECRET_LENGTH) {
            return $fallback;
        }

        return null;
    }
}
