<?php

namespace App\Http\Controllers\Mobile\V1\Fic;

use App\Services\MobileApiService;
use App\Services\Mobile\FicService;
use Illuminate\Http\Request;

class StudiesController
{
    public function __invoke(Request $request, FicService $service)
    {
        return MobileApiService::json($service->studies($request->get('authUser'), $request->query('q'), (int) $request->query('limit', 50)));
    }
}
