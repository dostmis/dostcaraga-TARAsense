<?php

namespace App\Services\Mobile;

use App\Models\Panelist;
use App\Models\SensoryResponse;
use App\Models\Study;
use App\Models\StudyParticipant;
use App\Services\UserUsageService;
use Illuminate\Support\Facades\DB;

class ConsumerService
{
    public function availableStudies(string $userId, ?string $query = null, int $limit = 20): array
    {
        $panelist = Panelist::query()->where('userId', $userId)->first();
        $boundedLimit = max(1, min($limit, 50));

        if (!$panelist || !$panelist->isActive) {
            return [
                'profileRequired' => true,
                'studies' => [],
                'meta' => ['query' => mb_strtolower(trim((string) $query)), 'limit' => $boundedLimit, 'count' => 0],
            ];
        }

        $studies = Study::query()
            ->whereIn('status', ['RECRUITING', 'ACTIVE'])
            ->whereHas('sensoryAttributes')
            ->with(['participants.panelist'])
            ->withCount(['sensoryAttributes', 'participants', 'responses'])
            ->orderByDesc('createdAt')
            ->limit($boundedLimit * 3)
            ->get()
            ->filter(function (Study $study) use ($panelist): bool {
                $mine = $study->participants->first(fn ($participant) => $participant->panelistId === $panelist->id);
                return $mine?->status !== 'COMPLETED';
            });

        $filtered = $this->filterStudies($studies, $query)->take($boundedLimit)->values();

        return [
            'profileRequired' => false,
            'studies' => $filtered->map(fn (Study $study) => $this->serializeConsumerStudy($study, $panelist))->all(),
            'meta' => ['query' => mb_strtolower(trim((string) $query)), 'limit' => $boundedLimit, 'count' => $filtered->count()],
        ];
    }

    public function completedStudies(string $userId, ?string $query = null, int $limit = 20): array
    {
        $panelist = Panelist::query()->where('userId', $userId)->first();
        $boundedLimit = max(1, min($limit, 50));

        if (!$panelist) {
            return [
                'profileRequired' => true,
                'studies' => [],
                'meta' => ['query' => mb_strtolower(trim((string) $query)), 'limit' => $boundedLimit, 'count' => 0],
            ];
        }

        $rows = StudyParticipant::query()
            ->with(['study' => fn ($query) => $query->withCount(['sensoryAttributes', 'participants', 'responses']), 'responses'])
            ->where('panelistId', $panelist->id)
            ->where('status', 'COMPLETED')
            ->orderByDesc('completedAt')
            ->orderByDesc('selectionOrder')
            ->limit($boundedLimit * 3)
            ->get();

        $matched = $rows->filter(function (StudyParticipant $participation) use ($query): bool {
            return $this->matchesStudy($participation->study, $query);
        })->take($boundedLimit)->values();

        return [
            'profileRequired' => false,
            'studies' => $matched->map(function (StudyParticipant $participation) {
                $study = $participation->study;
                $response = $participation->responses->sortByDesc('submittedAt')->first();

                return [
                    'id' => $study->id,
                    'title' => $study->title,
                    'productName' => $study->productName,
                    'category' => $study->category,
                    'stage' => $study->stage,
                    'status' => $study->status,
                    'description' => $study->description,
                    'location' => $study->location,
                    'sampleSize' => $study->sampleSize,
                    'responseCount' => (int) ($study->responses_count ?? 0),
                    'participantCount' => (int) ($study->participants_count ?? 0),
                    'questionnaireCount' => (int) ($study->sensory_attributes_count ?? 0),
                    'createdAt' => DateService::iso($study->createdAt),
                    'updatedAt' => DateService::iso($study->updatedAt),
                    'myParticipation' => [
                        'id' => $participation->id,
                        'status' => $participation->status,
                        'panelistNumber' => $participation->panelistNumber,
                        'completedAt' => DateService::iso($participation->completedAt),
                        'responseId' => $response?->id,
                        'submittedAt' => DateService::iso($response?->submittedAt ?? $participation->completedAt),
                    ],
                    'links' => [
                        'completed' => "/test/completed?studyId={$study->id}",
                        'form' => "/studies/{$study->id}/form",
                    ],
                ];
            })->all(),
            'meta' => ['query' => mb_strtolower(trim((string) $query)), 'limit' => $boundedLimit, 'count' => $matched->count()],
        ];
    }

    public function form(string $studyId): array
    {
        $study = Study::query()
            ->with(['sensoryAttributes' => fn ($query) => $query->orderBy('order'), 'sensoryQuestions' => fn ($query) => $query->orderBy('order')])
            ->find($studyId);

        if (!$study) {
            return ['success' => false, 'error' => 'Study not found.'];
        }

        if (!in_array($study->status, ['RECRUITING', 'ACTIVE'], true)) {
            return ['success' => false, 'error' => 'This study is not available.'];
        }

        return [
            'success' => true,
            'form' => [
                'studyId' => $study->id,
                'title' => $study->title,
                'attributes' => $study->sensoryAttributes->map(fn ($attr) => [
                    'id' => $attr->id,
                    'name' => $attr->name,
                    'type' => $attr->type,
                    'order' => $attr->order,
                    'attributeType' => $attr->attributeType,
                    'jarOptions' => $attr->jarOptions,
                ])->all(),
                'questions' => $study->sensoryQuestions->map(fn ($question) => [
                    'id' => $question->getKey(),
                    'text' => $question->question_text ?? $question->questionText ?? null,
                    'type' => $question->question_type ?? $question->questionType ?? null,
                    'order' => $question->order,
                ])->all(),
            ],
        ];
    }

    public function join(string $userId, string $studyId, ?string $requestedSessionAt = null): array
    {
        $panelist = Panelist::query()->where('userId', $userId)->first();
        if (!$panelist || !$panelist->isActive) {
            return ['success' => false, 'error' => 'Complete your consumer profile before joining studies.'];
        }

        $study = Study::query()->find($studyId);
        if (!$study || !in_array($study->status, ['RECRUITING', 'ACTIVE'], true)) {
            return ['success' => false, 'error' => 'This study is not open for registration.'];
        }

        if (StudyParticipant::query()->where('studyId', $studyId)->where('panelistId', $panelist->id)->exists()) {
            return ['success' => false, 'error' => 'You have already joined this study.'];
        }

        $participant = DB::transaction(function () use ($studyId, $panelist, $requestedSessionAt) {
            $count = StudyParticipant::query()->where('studyId', $studyId)->lockForUpdate()->count();

            return StudyParticipant::query()->create([
                'studyId' => $studyId,
                'panelistId' => $panelist->id,
                'source' => 'REGISTERED_CONSUMER',
                'status' => 'SELECTED',
                'consentStatus' => 'PENDING',
                'requestedSessionAt' => $requestedSessionAt ? new \DateTimeImmutable($requestedSessionAt) : null,
                'selectionOrder' => $count + 1,
            ]);
        });

        UserUsageService::log([
            'actorUserId' => $userId,
            'action' => 'STUDY_PARTICIPATION_SUBMITTED',
            'entityType' => 'Study',
            'entityId' => $studyId,
            'summary' => "Joined study \"{$study->title}\" from mobile.",
            'metadata' => ['channel' => 'mobile', 'studyId' => $studyId, 'participantId' => $participant->id],
        ]);

        return [
            'success' => true,
            'participant' => [
                'id' => $participant->id,
                'studyId' => $participant->studyId,
                'status' => $participant->status,
                'consentStatus' => $participant->consentStatus,
                'requestedSessionAt' => DateService::iso($participant->requestedSessionAt),
                'panelistNumber' => $participant->panelistNumber,
                'randomizeCode' => $participant->randomizeCode,
            ],
        ];
    }

    public function submitResponse(string $userId, string $studyId, string $participantId, array $payload): array
    {
        $participant = StudyParticipant::query()
            ->with(['panelist', 'study.sensoryAttributes'])
            ->where('id', $participantId)
            ->where('studyId', $studyId)
            ->first();

        if (!$participant) {
            return ['success' => false, 'error' => 'Participant not found for this study.'];
        }
        if ($participant->panelist?->userId !== $userId) {
            return ['success' => false, 'error' => 'You are not allowed to answer this study participant slot.'];
        }
        if ($participant->status === 'COMPLETED') {
            return ['success' => true, 'alreadySubmitted' => true, 'participant' => ['id' => $participant->id, 'status' => 'COMPLETED']];
        }
        if ($participant->status !== 'CONFIRMED') {
            return ['success' => false, 'error' => 'Participant slot is not confirmed for evaluation.'];
        }

        $validation = $this->validateResponsePayload($payload);
        if ($validation !== null) {
            return ['success' => false, 'error' => $validation];
        }

        $response = DB::transaction(function () use ($participant, $studyId, $payload) {
            $updated = StudyParticipant::query()
                ->where('id', $participant->id)
                ->where('status', '!=', 'COMPLETED')
                ->update(['status' => 'COMPLETED', 'completedAt' => now()]);

            if ($updated === 0) {
                return null;
            }

            return SensoryResponse::query()->create([
                'studyId' => $studyId,
                'participantId' => $participant->id,
                'data' => [
                    'overallLiking' => $payload['overallLiking'],
                    'attributes' => $payload['attributes'] ?? [],
                    'sampleResponses' => $payload['sampleResponses'] ?? [],
                    'sampleRanking' => $payload['sampleRanking'] ?? [],
                    'comments' => $payload['comments'] ?? [],
                ],
                'submittedAt' => !empty($payload['submittedAt']) ? new \DateTimeImmutable($payload['submittedAt']) : now(),
            ]);
        });

        if (!$response) {
            return ['success' => true, 'alreadySubmitted' => true, 'participant' => ['id' => $participant->id, 'status' => 'COMPLETED']];
        }

        UserUsageService::log([
            'actorUserId' => $userId,
            'action' => 'SENSORY_RESPONSE_SUBMITTED',
            'entityType' => 'Study',
            'entityId' => $studyId,
            'summary' => "Submitted sensory response for \"{$participant->study->title}\" from mobile.",
            'metadata' => ['channel' => 'mobile', 'studyId' => $studyId, 'participantId' => $participantId, 'responseId' => $response->id],
        ]);

        return [
            'success' => true,
            'response' => [
                'id' => $response->id,
                'submittedAt' => DateService::iso($response->submittedAt),
            ],
            'participant' => [
                'id' => $participant->id,
                'status' => 'COMPLETED',
            ],
        ];
    }

    private function serializeConsumerStudy(Study $study, Panelist $panelist): array
    {
        $mine = $study->participants->first(fn ($participant) => $participant->panelistId === $panelist->id);

        return [
            'id' => $study->id,
            'title' => $study->title,
            'productName' => $study->productName,
            'category' => $study->category,
            'stage' => $study->stage,
            'status' => $study->status,
            'description' => $study->description,
            'location' => $study->location,
            'sampleSize' => $study->sampleSize,
            'responseCount' => (int) ($study->responses_count ?? 0),
            'participantCount' => (int) ($study->participants_count ?? 0),
            'questionnaireCount' => (int) ($study->sensory_attributes_count ?? 0),
            'createdAt' => DateService::iso($study->createdAt),
            'updatedAt' => DateService::iso($study->updatedAt),
            'myParticipation' => $mine ? [
                'id' => $mine->id,
                'status' => $mine->status,
                'panelistNumber' => $mine->panelistNumber,
                'requestedSessionAt' => DateService::iso($mine->requestedSessionAt),
                'sessionAt' => DateService::iso($mine->sessionAt),
            ] : null,
            'sessionSlots' => [],
            'links' => [
                'form' => "/studies/{$study->id}/form",
                'join' => "/studies/{$study->id}/start",
            ],
        ];
    }

    private function filterStudies($studies, ?string $query)
    {
        return $studies->filter(fn (Study $study) => $this->matchesStudy($study, $query))->values();
    }

    private function matchesStudy(Study $study, ?string $query): bool
    {
        $normalizedQuery = mb_strtolower(trim((string) $query));
        if ($normalizedQuery === '') {
            return true;
        }

        return str_contains(mb_strtolower(implode(' ', [
            $study->title,
            $study->productName,
            $study->category,
            $study->stage,
            $study->status,
            $study->location,
        ])), $normalizedQuery);
    }

    private function validateResponsePayload(array $payload): ?string
    {
        $overall = $payload['overallLiking'] ?? null;
        if (!is_numeric($overall) || $overall < 1 || $overall > 9) {
            return 'overallLiking must be a number from 1 to 9.';
        }

        if (isset($payload['attributes']) && (!is_array($payload['attributes']) || count($payload['attributes']) > 40)) {
            return 'attributes must be an object with at most 40 fields.';
        }

        if (isset($payload['sampleResponses']) && (!is_array($payload['sampleResponses']) || count($payload['sampleResponses']) > 20)) {
            return 'sampleResponses can contain at most 20 items.';
        }

        return null;
    }
}
