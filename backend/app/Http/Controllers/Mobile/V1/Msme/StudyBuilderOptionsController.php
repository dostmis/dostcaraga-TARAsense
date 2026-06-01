<?php

namespace App\Http\Controllers\Mobile\V1\Msme;

use App\Services\MobileApiService;
use App\Services\Mobile\MsmeService;
use Illuminate\Http\Request;

class StudyBuilderOptionsController
{
    public function __invoke(Request $request, MsmeService $service)
    {
        return MobileApiService::json($service->studyBuilderOptions());
    }
}
