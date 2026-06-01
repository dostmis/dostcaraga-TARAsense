<?php

namespace App\Services;

use App\Models\User;
use App\Models\UserUsageLog;

class UserUsageService
{
    public static function log(array $input): void
    {
        $actor = null;

        if (!empty($input['actorUserId'])) {
            $actor = User::query()->find($input['actorUserId']);
        }

        UserUsageLog::query()->create([
            'actorUserId' => $input['actorUserId'] ?? null,
            'actorName' => $input['actorName'] ?? $actor?->name,
            'actorEmail' => $input['actorEmail'] ?? $actor?->email,
            'actorRole' => $input['actorRole'] ?? $actor?->role,
            'action' => $input['action'],
            'entityType' => $input['entityType'] ?? null,
            'entityId' => $input['entityId'] ?? null,
            'summary' => $input['summary'],
            'metadata' => $input['metadata'] ?? null,
            'ipAddress' => request()?->ip(),
            'userAgent' => request()?->userAgent(),
        ]);
    }
}
