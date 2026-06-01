<?php

namespace App\Services\Auth;

/**
 * Verifies passwords hashed with Node.js crypto.scryptSync.
 *
 * Format stored in DB: "{salt_hex}:{derived_key_hex}"
 * - salt_hex: 16 random bytes as hex (32 hex chars)
 * - derived_key_hex: 64 bytes scrypt output as hex (128 hex chars)
 *
 * Node.js scryptSync defaults: N=16384, r=8, p=1, keylen=64
 */
class PasswordService
{
    private const SCRYPT_N = 16384;
    private const SCRYPT_R = 8;
    private const SCRYPT_P = 1;
    private const KEY_LEN = 64;

    /**
     * Hash a password using the same storage format as src/lib/auth/password.ts.
     */
    public static function hash(string $password): string
    {
        $salt = random_bytes(16);
        $derived = self::deriveScrypt($password, $salt);

        if ($derived === null) {
            throw new \RuntimeException('PHP sodium scrypt support is required for password hashing.');
        }

        return bin2hex($salt) . ':' . bin2hex($derived);
    }

    /**
     * Verify a password against a stored scrypt hash.
     */
    public static function verify(string $password, string $stored): bool
    {
        $parts = explode(':', $stored, 2);

        if (count($parts) !== 2) {
            return false;
        }

        [$saltHex, $hashHex] = $parts;

        if (strlen($saltHex) !== 32 || strlen($hashHex) !== 128) {
            return false;
        }

        $salt = hex2bin($saltHex);
        $expected = hex2bin($hashHex);

        if ($salt === false || $expected === false) {
            return false;
        }

        $derived = self::deriveScrypt($password, $salt);

        if ($derived === null) {
            return false;
        }

        return hash_equals($expected, $derived);
    }

    /**
     * Derive a scrypt key using the same parameters as Node.js crypto.scryptSync.
     */
    private static function deriveScrypt(string $password, string $salt): ?string
    {
        return self::scrypt($password, $salt, self::SCRYPT_N, self::SCRYPT_R, self::SCRYPT_P, self::KEY_LEN);
    }

    /**
     * RFC 7914 scrypt implementation for Node.js crypto.scryptSync parity.
     */
    private static function scrypt(string $password, string $salt, int $n, int $r, int $p, int $dkLen): string
    {
        $blockSize = 128 * $r;
        $b = hash_pbkdf2('sha256', $password, $salt, 1, $p * $blockSize, true);
        $blocks = str_split($b, $blockSize);

        for ($i = 0; $i < $p; $i++) {
            $blocks[$i] = self::sMix($blocks[$i], $r, $n);
        }

        return hash_pbkdf2('sha256', $password, implode('', $blocks), 1, $dkLen, true);
    }

    private static function sMix(string $block, int $r, int $n): string
    {
        $x = $block;
        $v = [];

        for ($i = 0; $i < $n; $i++) {
            $v[$i] = $x;
            $x = self::blockMix($x, $r);
        }

        for ($i = 0; $i < $n; $i++) {
            $j = self::integerify($x, $r) & ($n - 1);
            $x = self::blockMix($x ^ $v[$j], $r);
        }

        return $x;
    }

    private static function blockMix(string $block, int $r): string
    {
        $chunks = str_split($block, 64);
        $x = $chunks[(2 * $r) - 1];
        $y = [];

        for ($i = 0; $i < 2 * $r; $i++) {
            $x = self::salsa208($x ^ $chunks[$i]);
            $y[$i] = $x;
        }

        $out = '';
        for ($i = 0; $i < $r; $i++) {
            $out .= $y[2 * $i];
        }
        for ($i = 0; $i < $r; $i++) {
            $out .= $y[(2 * $i) + 1];
        }

        return $out;
    }

    private static function integerify(string $block, int $r): int
    {
        $chunk = substr($block, (2 * $r - 1) * 64, 8);
        $parts = unpack('V2', $chunk);

        return (int) (($parts[2] << 32) | $parts[1]);
    }

    private static function salsa208(string $block): string
    {
        $input = array_values(unpack('V16', $block));
        $x = $input;

        for ($i = 0; $i < 8; $i += 2) {
            self::quarterRound($x, 0, 4, 8, 12);
            self::quarterRound($x, 5, 9, 13, 1);
            self::quarterRound($x, 10, 14, 2, 6);
            self::quarterRound($x, 15, 3, 7, 11);
            self::quarterRound($x, 0, 1, 2, 3);
            self::quarterRound($x, 5, 6, 7, 4);
            self::quarterRound($x, 10, 11, 8, 9);
            self::quarterRound($x, 15, 12, 13, 14);
        }

        $out = '';
        for ($i = 0; $i < 16; $i++) {
            $out .= pack('V', ($x[$i] + $input[$i]) & 0xffffffff);
        }

        return $out;
    }

    private static function quarterRound(array &$x, int $a, int $b, int $c, int $d): void
    {
        $x[$b] ^= self::rotl(($x[$a] + $x[$d]) & 0xffffffff, 7);
        $x[$c] ^= self::rotl(($x[$b] + $x[$a]) & 0xffffffff, 9);
        $x[$d] ^= self::rotl(($x[$c] + $x[$b]) & 0xffffffff, 13);
        $x[$a] ^= self::rotl(($x[$d] + $x[$c]) & 0xffffffff, 18);
    }

    private static function rotl(int $value, int $shift): int
    {
        return (($value << $shift) | (($value & 0xffffffff) >> (32 - $shift))) & 0xffffffff;
    }
}
