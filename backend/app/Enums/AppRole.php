<?php

namespace App\Enums;

/**
 * Normalized application roles matching the frontend role system.
 * Mirrors src/lib/auth/roles.ts exactly.
 */
enum AppRole: string
{
    case MSME = 'MSME';
    case FIC = 'FIC';
    case CONSUMER = 'CONSUMER';
    case ADMIN = 'ADMIN';

    public function dashboardPath(): string
    {
        return match ($this) {
            self::MSME => '/msme/dashboard',
            self::FIC => '/fic/dashboard',
            self::CONSUMER => '/consumer/dashboard',
            self::ADMIN => '/admin/dashboard',
        };
    }

    /**
     * Parse a raw UserRole enum value into the normalized AppRole.
     * Mirrors parseRole() in src/lib/auth/roles.ts.
     */
    public static function parse(string $value): ?self
    {
        return match ($value) {
            'FIC_MANAGER' => self::FIC,
            'RESEARCHER' => self::CONSUMER,
            'MSME' => self::MSME,
            'FIC' => self::FIC,
            'CONSUMER' => self::CONSUMER,
            'ADMIN' => self::ADMIN,
            default => null,
        };
    }

    public function prismaRole(): UserRole
    {
        return UserRole::from($this->value);
    }
}
