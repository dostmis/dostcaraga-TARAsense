<?php

namespace App\Services\Auth;

/**
 * HMAC-SHA256 session token service.
 * Mirrors src/lib/auth/session-token.ts exactly.
 *
 * Token format: {base64url_payload}.{base64url_hmac_signature}
 * Payload: {"uid":"...","iat":...,"exp":...}
 * TTL: 7 days (604800 seconds)
 * Cookie key: tara_session
 */
class SessionTokenService
{
    public const COOKIE_KEY = 'tara_session';
    private const TTL_SECONDS = 604800; // 7 days
    private const MIN_SECRET_LENGTH = 32;

    /**
     * Create a signed session token for a user.
     */
    public static function create(string $userId, ?\DateTimeInterface $now = null): string
    {
        $now = $now ?? new \DateTimeImmutable();
        $issuedAt = (int) $now->format('U');

        $payload = [
            'uid' => $userId,
            'iat' => $issuedAt,
            'exp' => $issuedAt + self::TTL_SECONDS,
        ];

        $payloadBase64 = self::base64urlEncode(json_encode($payload));
        $signature = self::sign($payloadBase64, self::getSecret());

        return "{$payloadBase64}.{$signature}";
    }

    /**
     * Verify a session token. Returns userId and expiresAt, or null if invalid.
     */
    public static function verify(string $token): ?array
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

        $expectedSignature = self::sign($payloadBase64, $secret);

        if (!hash_equals($expectedSignature, $signature)) {
            return null;
        }

        $payloadJson = self::base64urlDecode($payloadBase64);

        if ($payloadJson === null) {
            return null;
        }

        $payload = json_decode($payloadJson, true);

        if (!is_array($payload)) {
            return null;
        }

        if (
            !isset($payload['uid'], $payload['iat'], $payload['exp']) ||
            !is_string($payload['uid']) ||
            strlen($payload['uid']) === 0 ||
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

    public static function isConfigured(): bool
    {
        return self::readSecret() !== null;
    }

    private static function getSecret(): string
    {
        $secret = self::readSecret();

        if ($secret === null) {
            throw new \RuntimeException(
                'SESSION_SECRET must be set and at least ' . self::MIN_SECRET_LENGTH . ' characters long.'
            );
        }

        return $secret;
    }

    private static function readSecret(): ?string
    {
        $secret = env('SESSION_SECRET', '');

        if (strlen($secret) >= self::MIN_SECRET_LENGTH) {
            return $secret;
        }

        return null;
    }

    private static function sign(string $payloadBase64, string $secret): string
    {
        return self::base64urlEncode(hash_hmac('sha256', $payloadBase64, $secret, true));
    }

    public static function base64urlEncode(string $data): string
    {
        return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
    }

    public static function base64urlDecode(string $data): ?string
    {
        $padded = strtr($data, '-_', '+/');
        $decoded = base64_decode($padded, true);

        return $decoded !== false ? $decoded : null;
    }
}
