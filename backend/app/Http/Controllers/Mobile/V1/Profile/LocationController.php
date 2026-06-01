<?php

namespace App\Http\Controllers\Mobile\V1\Profile;

use App\Services\MobileApiService;
use App\Services\Mobile\LocationService;
use Illuminate\Http\Request;

class LocationController
{
    public function __invoke(Request $request, LocationService $service)
    {
        $result = $service->list((string) $request->query('level'), $request->query('parentId'), $request->query('q'));
        if (($result['ok'] ?? false) !== true) {
            return MobileApiService::error($result['error'] ?? 'Invalid location query.', $result['status'] ?? 400, 'LOCATION_QUERY_FAILED');
        }
        return MobileApiService::json(['items' => $result['items']]);
    }
}
