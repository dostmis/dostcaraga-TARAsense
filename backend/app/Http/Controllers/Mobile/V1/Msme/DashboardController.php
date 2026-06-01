<?php

namespace App\Http\Controllers\Mobile\V1\Msme;

use App\Services\MobileApiService;
use App\Services\Mobile\MsmeService;
use Illuminate\Http\Request;

class DashboardController
{
    public function __invoke(Request $request, MsmeService $service)
    {
        $user = $request->get('authUser');
        return MobileApiService::json($service->dashboard($user['id'], $request->query('q')));
    }
}
