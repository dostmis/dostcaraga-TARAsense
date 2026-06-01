<?php

namespace App\Services\Notifications;

use App\Jobs\SendPushNotificationJob;
use App\Models\Notification;
use App\Models\User;

class NotificationService
{
    public function notifyUser(string $userId, array $input): ?Notification
    {
        $notification = Notification::query()->create([
            'userId' => $userId,
            'title' => trim((string) ($input['title'] ?? '')),
            'message' => trim((string) ($input['message'] ?? '')),
            'level' => $input['level'] ?? 'INFO',
            'category' => $input['category'] ?? 'SYSTEM',
            'actionUrl' => $input['actionUrl'] ?? null,
            'metadata' => $input['metadata'] ?? null,
            'isRead' => false,
        ]);

        SendPushNotificationJob::dispatch($userId, [
            'title' => $notification->title,
            'message' => $notification->message,
            'actionUrl' => $notification->actionUrl,
            'metadata' => $notification->metadata,
        ])->onQueue('notifications');

        return $notification;
    }

    public function notifyRole(string $role, array $input): int
    {
        $users = User::query()->where('role', $role)->pluck('id');

        foreach ($users as $userId) {
            $this->notifyUser($userId, $input);
        }

        return $users->count();
    }
}
