<?php

namespace App\Http\Controllers\Mobile\V1\Profile;

use App\Services\MobileApiService;
use App\Services\Mobile\ProfileService;
use Illuminate\Http\Request;

class ProfileController
{
    public function show(Request $request, ProfileService $service)
    {
        return MobileApiService::json($service->show($request->get('authUser')));
    }

    public function update(Request $request, ProfileService $service)
    {
        $result = $service->update($request->get('authUser'), $request->json()->all() ?: []);
        if (($result['ok'] ?? false) !== true) {
            return MobileApiService::error($result['error'] ?? 'Failed to update profile.', $result['status'] ?? 400, 'PROFILE_UPDATE_FAILED');
        }
        return MobileApiService::json($result);
    }

    public function updateLocation(Request $request, ProfileService $service)
    {
        $result = $service->updateLocation($request->get('authUser'), $request->json()->all() ?: []);
        if (($result['ok'] ?? false) !== true) {
            return MobileApiService::error($result['error'] ?? 'Failed to update profile location.', $result['status'] ?? 400, 'PROFILE_LOCATION_UPDATE_FAILED');
        }
        return MobileApiService::json($result);
    }
}
