<?php

namespace App\Http\Controllers\Mobile\V1\Fic;

use App\Services\MobileApiService;
use App\Services\Mobile\FicService;
use Illuminate\Http\Request;

class DashboardController
{
    public function __invoke(Request $request, FicService $service)
    {
        return MobileApiService::json($service->dashboard($request->get('authUser'), $request->query('q')));
    }
}
