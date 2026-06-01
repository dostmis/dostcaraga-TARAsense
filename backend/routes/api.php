<?php

use App\Http\Middleware\MobileAuth;
use App\Http\Middleware\WebAuth;
use App\Http\Controllers\Api\V1\AuthController;
use App\Http\Controllers\Api\V1\ChatController;
use App\Http\Controllers\Api\V1\LocationController;
use App\Http\Controllers\Api\V1\StudyReportController;
use Illuminate\Support\Facades\Route;

Route::prefix('v1')->group(function () {
    Route::prefix('auth')->group(function () {
        Route::post('/login', [AuthController::class, 'login']);
        Route::get('/me', [AuthController::class, 'me']);
        Route::post('/logout', [AuthController::class, 'logout']);
    });

    Route::prefix('chat')->group(function () {
        Route::get('/', [ChatController::class, 'status']);
        Route::post('/', [ChatController::class, 'reply']);
    });

    Route::prefix('locations')->middleware(WebAuth::class)->group(function () {
        Route::get('/regions', [LocationController::class, 'regions']);
        Route::get('/provinces', [LocationController::class, 'provinces']);
        Route::get('/cities', [LocationController::class, 'cities']);
        Route::get('/barangays', [LocationController::class, 'barangays']);
    });

    Route::prefix('studies')->middleware(WebAuth::class)->group(function () {
        Route::get('/{studyId}/analysis', [StudyReportController::class, 'analysis']);
        Route::post('/{studyId}/analysis/compare', [StudyReportController::class, 'compare']);
        Route::get('/{studyId}/reports/pdf', [StudyReportController::class, 'pdf']);
    });
});

// ============================================================================
// Mobile API v1
// Mirrors src/app/api/mobile/v1/ route structure exactly.
// ============================================================================
Route::prefix('mobile/v1')->group(function () {

    // Auth routes — public (no middleware), rate-limited in controller
    Route::prefix('auth')->group(function () {
        Route::post('/login', [\App\Http\Controllers\Mobile\V1\Auth\LoginController::class, '__invoke']);
        Route::post('/register', [\App\Http\Controllers\Mobile\V1\Auth\RegisterController::class, '__invoke']);
        Route::post('/refresh', [\App\Http\Controllers\Mobile\V1\Auth\RefreshController::class, '__invoke']);
        Route::post('/logout', [\App\Http\Controllers\Mobile\V1\Auth\LogoutController::class, '__invoke'])
            ->middleware(MobileAuth::class);
        Route::get('/me', [\App\Http\Controllers\Mobile\V1\Auth\MeController::class, '__invoke'])
            ->middleware(MobileAuth::class);
        Route::post('/device-token', [\App\Http\Controllers\Mobile\V1\Auth\DeviceTokenController::class, 'store'])
            ->middleware(MobileAuth::class);
        Route::post('/device-token/remove', [\App\Http\Controllers\Mobile\V1\Auth\DeviceTokenController::class, 'remove'])
            ->middleware(MobileAuth::class);
    });

    // Consumer routes
    Route::prefix('consumer')->middleware([MobileAuth::class . ':CONSUMER'])->group(function () {
        Route::get('/studies', [\App\Http\Controllers\Mobile\V1\Consumer\StudiesController::class, 'index']);
        Route::get('/studies/completed', [\App\Http\Controllers\Mobile\V1\Consumer\StudiesController::class, 'completed']);
        Route::get('/studies/{studyId}/form', [\App\Http\Controllers\Mobile\V1\Consumer\FormController::class, '__invoke']);
        Route::post('/studies/{studyId}/join', [\App\Http\Controllers\Mobile\V1\Consumer\JoinController::class, '__invoke']);
        Route::post('/studies/{studyId}/participants/{participantId}/responses', [\App\Http\Controllers\Mobile\V1\Consumer\ResponseController::class, '__invoke']);
    });

    // MSME routes
    Route::prefix('msme')->middleware([MobileAuth::class . ':MSME,ADMIN'])->group(function () {
        Route::get('/dashboard', [\App\Http\Controllers\Mobile\V1\Msme\DashboardController::class, '__invoke']);
        Route::get('/studies', [\App\Http\Controllers\Mobile\V1\Msme\StudiesController::class, '__invoke']);
        Route::get('/study-builder-options', [\App\Http\Controllers\Mobile\V1\Msme\StudyBuilderOptionsController::class, '__invoke']);
    });

    // FIC routes
    Route::prefix('fic')->middleware([MobileAuth::class . ':FIC,ADMIN'])->group(function () {
        Route::get('/dashboard', [\App\Http\Controllers\Mobile\V1\Fic\DashboardController::class, '__invoke']);
        Route::get('/studies', [\App\Http\Controllers\Mobile\V1\Fic\StudiesController::class, '__invoke']);
        Route::get('/calendar', [\App\Http\Controllers\Mobile\V1\Fic\CalendarController::class, '__invoke']);
        Route::get('/availability/{date}', [\App\Http\Controllers\Mobile\V1\Fic\AvailabilityController::class, 'show']);
        Route::post('/availability', [\App\Http\Controllers\Mobile\V1\Fic\AvailabilityController::class, 'update']);
    });

    // Profile routes
    Route::prefix('profile')->middleware([MobileAuth::class])->group(function () {
        Route::get('/', [\App\Http\Controllers\Mobile\V1\Profile\ProfileController::class, 'show']);
        Route::put('/', [\App\Http\Controllers\Mobile\V1\Profile\ProfileController::class, 'update']);
        Route::put('/location', [\App\Http\Controllers\Mobile\V1\Profile\ProfileController::class, 'updateLocation']);
    });

    // Locations routes
    Route::prefix('locations')->middleware([MobileAuth::class])->group(function () {
        Route::get('/', [\App\Http\Controllers\Mobile\V1\Profile\LocationController::class, '__invoke']);
    });

    // Catch-all for unmapped mobile routes
    Route::any('/{path?}', function () {
        return \App\Services\MobileApiService::error(
            'Mobile API endpoint not found.',
            404,
            'NOT_FOUND'
        );
    })->where('path', '.*');
});
