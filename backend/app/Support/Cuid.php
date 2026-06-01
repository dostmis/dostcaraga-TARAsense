<?php

namespace App\Support;

class Cuid
{
    private static int $counter = 0;

    public static function make(): string
    {
        self::$counter = (self::$counter + 1) % 1679616;

        return 'c'
            . self::base36((int) floor(microtime(true) * 1000))
            . str_pad(self::base36(self::$counter), 4, '0', STR_PAD_LEFT)
            . self::base36(random_int(60466176, 2176782335));
    }

    private static function base36(int $value): string
    {
        return strtolower(base_convert((string) $value, 10, 36));
    }
}
