<?php

namespace App\Services\Mobile;

use App\Models\FicAvailability;
use App\Models\Study;
use App\Models\StudyParticipant;

class FicService
{
    public function dashboard(array $user, ?string $query = null): array
    {
        $studyQuery = $this->studyQuery($user);
        $studies = (clone $studyQuery)
            ->with('creator')
            ->withCount(['responses', 'participants'])
            ->orderByDesc('createdAt')
            ->limit(50)
            ->get();

        $filtered = $this->filterStudies($studies, $query);

        return [
            'timezone' => DateService::TIMEZONE,
            'assignment' => $this->assignment($user),
            'stats' => [
                'bookingNotifications' => (clone $studyQuery)->count(),
                'upcomingSessions' => $this->sessionQuery($user)->where(function ($query): void {
                    $query->where('sessionAt', '>=', now())->orWhere('requestedSessionAt', '>=', now());
                })->count(),
                'pendingConfirmation' => $this->sessionQuery($user)
                    ->whereNull('sessionAt')
                    ->where('requestedSessionAt', '>=', now())
                    ->count(),
                'uploadedStudies' => Study::query()->count(),
                'activeStudies' => (clone $studyQuery)->whereIn('status', ['ACTIVE', 'RECRUITING'])->count(),
                'totalResponses' => \App\Models\SensoryResponse::query()->whereHas('study', fn ($query) => $this->applyStudyVisibility($query, $user))->count(),
            ],
            'studies' => $filtered->map(fn (Study $study) => $this->serializeStudy($study))->all(),
            'meta' => [
                'query' => mb_strtolower(trim((string) $query)),
                'count' => $filtered->count(),
                'assignedFacilityRequired' => ($user['role'] ?? null) === 'FIC' && empty($user['assignedFacility']),
            ],
        ];
    }

    public function studies(array $user, ?string $query = null, int $limit = 50): array
    {
        $studies = $this->studyQuery($user)
            ->with('creator')
            ->withCount(['responses', 'participants'])
            ->orderByDesc('createdAt')
            ->limit(max(1, min($limit * 2, 200)))
            ->get();

        $filtered = $this->filterStudies($studies, $query)->take(max(1, min($limit, 100)))->values();

        return [
            'studies' => $filtered->map(fn (Study $study) => $this->serializeStudy($study))->all(),
            'meta' => [
                'query' => mb_strtolower(trim((string) $query)),
                'limit' => max(1, min($limit, 100)),
                'count' => $filtered->count(),
                'assignment' => $this->assignment($user),
            ],
        ];
    }

    public function calendar(array $user, ?string $query = null, int $limit = 100): array
    {
        $rows = $this->sessionQuery($user)
            ->with(['study.creator', 'panelist'])
            ->where(function ($query): void {
                $query->whereNotNull('sessionAt')->orWhereNotNull('requestedSessionAt');
            })
            ->limit(max(1, min($limit, 300)))
            ->get();

        $today = DateService::todayKey();
        $normalizedQuery = mb_strtolower(trim((string) $query));

        $sessions = $rows->map(function (StudyParticipant $row) {
            $scheduledAt = $row->sessionAt ?? $row->requestedSessionAt;
            if (!$scheduledAt) {
                return null;
            }

            $study = $row->study;

            return [
                'id' => $row->id,
                'studyId' => $study->id,
                'studyTitle' => $study->title,
                'productName' => $study->productName,
                'location' => $study->location,
                'panelistName' => $row->panelist?->name,
                'panelistNumber' => $row->panelistNumber ? 'P' . str_pad((string) $row->panelistNumber, 3, '0', STR_PAD_LEFT) : null,
                'participantStatus' => $row->status,
                'sessionState' => $row->sessionAt ? 'CONFIRMED' : 'PENDING_CONFIRMATION',
                'scheduledAt' => DateService::iso($scheduledAt),
                'dateKey' => $scheduledAt->timezone(DateService::TIMEZONE)->format('Y-m-d'),
                'MSME' => [
                    'id' => $study->creator?->id,
                    'name' => $study->creator?->name,
                    'organization' => $study->creator?->organization,
                ],
                'links' => [
                    'form' => "/studies/{$study->id}/form",
                    'dashboard' => "/dashboard/{$study->id}",
                ],
            ];
        })
            ->filter()
            ->filter(fn ($row) => $row['dateKey'] >= $today)
            ->filter(function ($row) use ($normalizedQuery): bool {
                if ($normalizedQuery === '') {
                    return true;
                }

                return str_contains(mb_strtolower(implode(' ', [
                    $row['studyTitle'],
                    $row['productName'],
                    $row['location'],
                    $row['panelistName'],
                    $row['panelistNumber'],
                    $row['participantStatus'],
                    $row['MSME']['name'],
                    $row['MSME']['organization'],
                ])), $normalizedQuery);
            })
            ->sortBy('scheduledAt')
            ->values();

        return [
            'timezone' => DateService::TIMEZONE,
            'sessions' => $sessions->all(),
            'dates' => $sessions->groupBy('dateKey')->keys()->values()->all(),
            'meta' => [
                'query' => $normalizedQuery,
                'limit' => max(1, min($limit, 300)),
                'count' => $sessions->count(),
                'assignment' => $this->assignment($user),
            ],
        ];
    }

    public function availability(array $user, string $startDate, string $endDate): array
    {
        if (!DateService::isDateKey($startDate) || !DateService::isDateKey($endDate) || $startDate > $endDate) {
            return ['ok' => false, 'status' => 400, 'error' => 'Invalid date range.'];
        }

        $rows = FicAvailability::query()
            ->where('ficUserId', $user['id'])
            ->whereBetween('date', [$startDate, $endDate])
            ->orderBy('date')
            ->get();

        return [
            'ok' => true,
            'timezone' => DateService::TIMEZONE,
            'startDate' => $startDate,
            'endDate' => $endDate,
            'availability' => $rows->map(fn (FicAvailability $row) => $this->serializeAvailability($row))->all(),
        ];
    }

    public function setAvailability(array $user, string $date, mixed $isAvailable): array
    {
        if (!DateService::isDateKey($date)) {
            return ['ok' => false, 'status' => 400, 'error' => 'date must be YYYY-MM-DD.'];
        }

        if (!is_bool($isAvailable)) {
            return ['ok' => false, 'status' => 400, 'error' => 'isAvailable boolean is required.'];
        }

        $row = FicAvailability::query()
            ->where('ficUserId', $user['id'])
            ->where('date', $date)
            ->first();

        if ($row?->isLocked) {
            return ['ok' => false, 'status' => 409, 'error' => 'Cannot modify locked date already booked by a study.'];
        }

        $row = FicAvailability::query()->updateOrCreate(
            ['ficUserId' => $user['id'], 'date' => $date],
            ['isAvailable' => $isAvailable]
        );

        return ['ok' => true, 'availability' => $this->serializeAvailability($row)];
    }

    private function studyQuery(array $user)
    {
        return Study::query()->where(fn ($query) => $this->applyStudyVisibility($query, $user));
    }

    private function sessionQuery(array $user)
    {
        return StudyParticipant::query()
            ->whereIn('status', ['WAITLIST', 'SELECTED', 'CONFIRMED'])
            ->whereHas('study', fn ($query) => $this->applyStudyVisibility($query, $user));
    }

    private function applyStudyVisibility($query, array $user): void
    {
        if (($user['role'] ?? null) === 'ADMIN') {
            $query->where(function ($query): void {
                $query
                    ->whereRaw('"targetDemographics"->>\'coordinationMode\' = ?', ['FIC_ASSISTED'])
                    ->orWhereRaw('lower("location") like ?', ['%fic%']);
            });
            return;
        }

        $facility = trim((string) ($user['assignedFacility'] ?? ''));
        $query->whereRaw('lower("location") = ?', [mb_strtolower($facility ?: '__UNASSIGNED_FIC_FACILITY__')]);
    }

    private function filterStudies($studies, ?string $query)
    {
        $normalizedQuery = mb_strtolower(trim((string) $query));

        if ($normalizedQuery === '') {
            return $studies->values();
        }

        return $studies->filter(fn (Study $study) => str_contains(mb_strtolower(implode(' ', [
            $study->title,
            $study->productName,
            $study->location,
            $study->status,
            $study->creator?->name,
            $study->creator?->organization,
        ])), $normalizedQuery))->values();
    }

    private function serializeStudy(Study $study): array
    {
        return [
            'id' => $study->id,
            'title' => $study->title,
            'productName' => $study->productName,
            'category' => $study->category,
            'stage' => $study->stage,
            'description' => $study->description,
            'location' => $study->location,
            'status' => $study->status,
            'sampleSize' => $study->sampleSize,
            'createdAt' => DateService::iso($study->createdAt),
            'updatedAt' => DateService::iso($study->updatedAt),
            'MSME' => [
                'id' => $study->creator?->id,
                'name' => $study->creator?->name,
                'organization' => $study->creator?->organization,
            ],
            'responseCount' => (int) ($study->responses_count ?? 0),
            'participantCount' => (int) ($study->participants_count ?? 0),
            'targetReached' => (int) ($study->responses_count ?? 0) >= (int) $study->sampleSize,
            'links' => [
                'form' => "/studies/{$study->id}/form",
                'dashboard' => "/dashboard/{$study->id}",
            ],
        ];
    }

    private function serializeAvailability(FicAvailability $row): array
    {
        return [
            'id' => $row->id,
            'date' => $row->date,
            'isAvailable' => (bool) $row->isAvailable,
            'isLocked' => (bool) $row->isLocked,
            'lockedById' => $row->lockedById,
            'lockedAt' => DateService::iso($row->lockedAt),
            'updatedAt' => DateService::iso($row->updatedAt),
        ];
    }

    private function assignment(array $user): array
    {
        return [
            'assignedRegion' => $user['assignedRegion'] ?? null,
            'assignedFacility' => $user['assignedFacility'] ?? null,
        ];
    }
}
