<?php

namespace App\Http\Controllers\Mobile\V1\Consumer;

use App\Services\MobileApiService;
use App\Services\Mobile\ConsumerService;
use App\Services\RateLimitService;
use Illuminate\Http\Request;

class ResponseController
{
    public function __invoke(Request $request, ConsumerService $service, string $studyId, string $participantId)
    {
        $user = $request->get('authUser');
        $rate = RateLimitService::check("mobile-submit-response:{$user['id']}", RateLimitService::SUBMIT);
        if (!$rate['allowed']) {
            return MobileApiService::error('Too many response submissions. Please try again later.', 429, 'RATE_LIMITED');
        }

        $result = $service->submitResponse($user['id'], $studyId, $participantId, $request->json()->all() ?: []);
        if (($result['success'] ?? false) !== true) {
            return MobileApiService::error($result['error'] ?? 'Failed to submit response.', 400, 'SUBMIT_RESPONSE_FAILED');
        }
        return MobileApiService::json($result, empty($result['alreadySubmitted']) ? 201 : 200);
    }
}
