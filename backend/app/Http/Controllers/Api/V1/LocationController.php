<?php

namespace App\Http\Controllers\Api\V1;

use App\Services\ApiResponseService;
use App\Services\Mobile\LocationService;
use Illuminate\Http\Request;

class LocationController
{
    public function regions(Request $request, LocationService $service)
    {
        return $this->respond($service->list('region', null, $request->query('q')));
    }

    public function provinces(Request $request, LocationService $service)
    {
        return $this->respond($service->list('province', $request->query('regionId'), $request->query('q')));
    }

    public function cities(Request $request, LocationService $service)
    {
        return $this->respond($service->list('city', $request->query('provinceId'), $request->query('q')));
    }

    public function barangays(Request $request, LocationService $service)
    {
        return $this->respond($service->list('barangay', $request->query('cityId'), $request->query('q')));
    }

    private function respond(array $result)
    {
        if (($result['ok'] ?? false) !== true) {
            return ApiResponseService::error($result['error'] ?? 'Invalid location query.', $result['status'] ?? 400, 'LOCATION_QUERY_FAILED');
        }

        return ApiResponseService::json(['items' => $result['items']]);
    }
}
