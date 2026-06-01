<?php

namespace App\Http\Controllers\Mobile\V1\Fic;

use App\Services\MobileApiService;
use App\Services\Mobile\FicService;
use Illuminate\Http\Request;

class CalendarController
{
    public function __invoke(Request $request, FicService $service)
    {
        return MobileApiService::json($service->calendar($request->get('authUser'), $request->query('q'), (int) $request->query('limit', 100)));
    }
}
