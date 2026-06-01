<?php

namespace App\Http\Controllers\Mobile\V1\Consumer;

use App\Services\MobileApiService;
use App\Services\Mobile\ConsumerService;
use Illuminate\Http\Request;

class StudiesController
{
    public function index(Request $request, ConsumerService $service)
    {
        $user = $request->get('authUser');
        return MobileApiService::json($service->availableStudies($user['id'], $request->query('q'), (int) $request->query('limit', 20)));
    }

    public function completed(Request $request, ConsumerService $service)
    {
        $user = $request->get('authUser');
        return MobileApiService::json($service->completedStudies($user['id'], $request->query('q'), (int) $request->query('limit', 20)));
    }
}
