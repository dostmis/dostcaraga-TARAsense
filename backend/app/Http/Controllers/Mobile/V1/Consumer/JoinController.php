<?php

namespace App\Http\Controllers\Mobile\V1\Consumer;

use App\Services\MobileApiService;
use App\Services\Mobile\ConsumerService;
use App\Services\RateLimitService;
use Illuminate\Http\Request;

class JoinController
{
    public function __invoke(Request $request, ConsumerService $service, string $studyId)
    {
        $user = $request->get('authUser');
        $rate = RateLimitService::check("mobile-join-study:{$user['id']}", RateLimitService::MUTATION);
        if (!$rate['allowed']) {
            return MobileApiService::error('Too many requests. Please try again later.', 429, 'RATE_LIMITED');
        }

        $result = $service->join($user['id'], $studyId, $request->input('requestedSessionAt'));
        if (($result['success'] ?? false) !== true) {
            return MobileApiService::error($result['error'] ?? 'Failed to join study.', 400, 'JOIN_STUDY_FAILED');
        }
        return MobileApiService::json($result, 201);
    }
}
