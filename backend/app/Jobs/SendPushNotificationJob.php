<?php

namespace App\Jobs;

use App\Models\DeviceToken;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Log;

class SendPushNotificationJob implements ShouldQueue
{
    use Queueable;

    public function __construct(
        public string $userId,
        public array $payload
    ) {}

    public function handle(): void
    {
        $tokens = DeviceToken::query()
            ->where('userId', $this->userId)
            ->pluck('token')
            ->filter()
            ->values();

        if ($tokens->isEmpty()) {
            return;
        }

        if (blank(env('FIREBASE_SERVICE_ACCOUNT_JSON'))) {
            Log::info('Firebase push skipped; FIREBASE_SERVICE_ACCOUNT_JSON is not configured.', [
                'userId' => $this->userId,
                'tokenCount' => $tokens->count(),
            ]);
            return;
        }

        // Firebase HTTP v1 requires an OAuth access token derived from the
        // service account. Keep this job queued and isolated so the concrete
        // sender can be enabled without changing business services.
        Log::warning('Firebase push sender is not yet wired for Laravel.', [
            'userId' => $this->userId,
            'tokenCount' => $tokens->count(),
        ]);
    }
}
