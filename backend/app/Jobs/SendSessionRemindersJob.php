<?php

namespace App\Jobs;

use App\Models\StudyParticipant;
use App\Services\Notifications\NotificationService;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

class SendSessionRemindersJob implements ShouldQueue
{
    use Queueable;

    public function handle(NotificationService $notifications): void
    {
        $windowStart = now();
        $windowEnd = now()->addDay();

        StudyParticipant::query()
            ->with('panelist')
            ->whereIn('status', ['SELECTED', 'CONFIRMED'])
            ->whereNull('reminderSentAt')
            ->whereBetween('sessionAt', [$windowStart, $windowEnd])
            ->chunkById(100, function ($participants) use ($notifications): void {
                foreach ($participants as $participant) {
                    $userId = $participant->panelist?->userId;
                    if (!$userId) {
                        continue;
                    }

                    $notifications->notifyUser($userId, [
                        'title' => 'Upcoming sensory evaluation',
                        'message' => 'You have a scheduled TARAsense session within the next 24 hours.',
                        'category' => 'SURVEY',
                        'metadata' => [
                            'studyId' => $participant->studyId,
                            'participantId' => $participant->id,
                        ],
                    ]);

                    $participant->forceFill(['reminderSentAt' => now()])->save();
                }
            });
    }
}
