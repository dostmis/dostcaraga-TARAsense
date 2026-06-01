<?php

namespace App\Http\Controllers\Api\V1;

use App\Services\ApiResponseService;
use App\Services\Auth\WebAuthService;
use App\Services\OpenAI\ChatService;
use Illuminate\Http\Request;

class ChatController
{
    public function status(ChatService $service)
    {
        return ApiResponseService::json($service->status());
    }

    public function reply(Request $request, ChatService $service, WebAuthService $auth)
    {
        $user = $auth->currentUser($request->cookie(\App\Services\Auth\SessionTokenService::COOKIE_KEY));
        $result = $service->reply(
            $request->input('messages', []),
            $user['role'] ?? 'PUBLIC',
            data_get($request->input('context', []), 'pathname'),
            $user['id'] ?? null
        );

        if (($result['ok'] ?? false) !== true) {
            return ApiResponseService::error($result['error'], $result['status'] ?? 400, 'CHAT_REQUEST_FAILED');
        }

        unset($result['ok']);
        return ApiResponseService::json($result);
    }
}
