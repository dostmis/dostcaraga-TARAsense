<?php

namespace App\Http\Controllers\Mobile\V1\Consumer;

use App\Services\MobileApiService;
use App\Services\Mobile\ConsumerService;
use Illuminate\Http\Request;

class FormController
{
    public function __invoke(Request $request, ConsumerService $service, string $studyId)
    {
        $result = $service->form($studyId);
        if (($result['success'] ?? false) !== true) {
            return MobileApiService::error($result['error'] ?? 'Unable to fetch form.', 400, 'FORM_FETCH_FAILED');
        }
        return MobileApiService::json($result);
    }
}
