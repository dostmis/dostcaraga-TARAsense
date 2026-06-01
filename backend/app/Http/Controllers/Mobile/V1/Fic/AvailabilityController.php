<?php

namespace App\Http\Controllers\Mobile\V1\Fic;

use App\Services\MobileApiService;
use App\Services\Mobile\FicService;
use Illuminate\Http\Request;

class AvailabilityController
{
    public function show(Request $request, FicService $service, string $date)
    {
        $result = $service->availability($request->get('authUser'), $date, $date);
        if (($result['ok'] ?? false) !== true) {
            return MobileApiService::error($result['error'] ?? 'Invalid date.', $result['status'] ?? 400, 'AVAILABILITY_FETCH_FAILED');
        }

        return MobileApiService::json([
            'date' => $date,
            'availability' => $result['availability'][0] ?? null,
        ]);
    }

    public function update(Request $request, FicService $service)
    {
        $result = $service->setAvailability($request->get('authUser'), (string) $request->input('date'), $request->input('isAvailable'));
        if (($result['ok'] ?? false) !== true) {
            return MobileApiService::error($result['error'] ?? 'Failed to update availability.', $result['status'] ?? 400, 'AVAILABILITY_UPDATE_FAILED');
        }

        return MobileApiService::json($result);
    }
}
