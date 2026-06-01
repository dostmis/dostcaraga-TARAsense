<?php

namespace App\Services;

use Illuminate\Http\JsonResponse;

class ApiResponseService
{
    public static function json(mixed $data, int $status = 200, array $headers = []): JsonResponse
    {
        return response()->json($data, $status, array_merge([
            'Cache-Control' => 'no-store',
        ], $headers));
    }

    public static function error(string $message, int $status = 400, string $code = 'API_ERROR'): JsonResponse
    {
        return self::json([
            'error' => [
                'code' => $code,
                'message' => $message,
            ],
        ], $status);
    }
}
