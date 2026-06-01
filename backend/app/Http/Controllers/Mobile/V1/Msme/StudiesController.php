<?php

namespace App\Http\Controllers\Mobile\V1\Msme;

use App\Services\MobileApiService;
use App\Services\Mobile\MsmeService;
use Illuminate\Http\Request;

class StudiesController
{
    public function __invoke(Request $request, MsmeService $service)
    {
        $user = $request->get('authUser');
        return MobileApiService::json($service->studies($user['id'], $request->query('q'), (int) $request->query('limit', 50)));
    }
}
