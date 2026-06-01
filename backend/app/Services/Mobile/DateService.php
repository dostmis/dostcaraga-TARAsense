<?php

namespace App\Services\Mobile;

use Carbon\CarbonImmutable;

class DateService
{
    public const TIMEZONE = 'Asia/Manila';

    public static function iso(mixed $value): ?string
    {
        if ($value === null) {
            return null;
        }

        if ($value instanceof \DateTimeInterface) {
            return $value->format('Y-m-d\TH:i:s.v\Z');
        }

        return (string) $value;
    }

    public static function isDateKey(string $value): bool
    {
        return (bool) preg_match('/^\d{4}-\d{2}-\d{2}$/', $value)
            && CarbonImmutable::createFromFormat('Y-m-d', $value, self::TIMEZONE)?->format('Y-m-d') === $value;
    }

    public static function todayKey(): string
    {
        return CarbonImmutable::now(self::TIMEZONE)->format('Y-m-d');
    }
}
