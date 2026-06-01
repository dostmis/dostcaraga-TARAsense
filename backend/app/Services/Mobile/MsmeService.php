<?php

namespace App\Services\Mobile;

use App\Models\Study;
use App\Models\SensoryResponse;

class MsmeService
{
    public function dashboard(string $userId, ?string $query = null): array
    {
        $normalizedQuery = mb_strtolower(trim((string) $query));

        $base = Study::query()->where('creatorId', $userId);

        $studies = (clone $base)
            ->with(['participants.panelist'])
            ->withCount(['responses', 'participants'])
            ->orderByDesc('createdAt')
            ->limit(50)
            ->get();

        $filtered = $studies->filter(function (Study $study) use ($normalizedQuery): bool {
            if ($normalizedQuery === '') {
                return true;
            }

            $participants = $study->participants->map(fn ($row) => $row->panelist?->name ?? '')->implode(' ');

            return str_contains(mb_strtolower(implode(' ', [
                $study->title,
                $study->productName,
                $study->location,
                $study->category,
                $study->stage,
                $study->status,
                $participants,
            ])), $normalizedQuery);
        })->values();

        return [
            'stats' => [
                'ficBookings' => (clone $base)->where(function ($query): void {
                    $query
                        ->whereRaw('"targetDemographics"->>\'coordinationMode\' = ?', ['FIC_ASSISTED'])
                        ->orWhereRaw('lower("location") like ?', ['%fic%']);
                })->count(),
                'totalStudies' => (clone $base)->count(),
                'totalResponses' => SensoryResponse::query()->whereHas('study', fn ($query) => $query->where('creatorId', $userId))->count(),
                'activeStudies' => (clone $base)->whereIn('status', ['ACTIVE', 'RECRUITING'])->count(),
            ],
            'studies' => $filtered->map(fn (Study $study) => $this->serializeStudy($study))->all(),
        ];
    }

    public function studies(string $userId, ?string $query = null, int $limit = 50): array
    {
        $data = $this->dashboard($userId, $query);

        return [
            'studies' => array_slice($data['studies'], 0, max(1, min($limit, 100))),
            'meta' => [
                'query' => mb_strtolower(trim((string) $query)),
                'count' => count($data['studies']),
            ],
        ];
    }

    public function studyBuilderOptions(): array
    {
        return [
            'timezone' => DateService::TIMEZONE,
            'studyModes' => [
                ['value' => 'MARKET', 'label' => 'Market Study'],
                ['value' => 'SENSORY', 'label' => 'Sensory Study'],
            ],
            'coordinationModes' => [
                ['value' => 'FIC_ASSISTED', 'label' => 'FIC-assisted'],
                ['value' => 'SELF_MANAGED_PUBLIC', 'label' => 'Self-managed public venue'],
            ],
            'marketStudyTypes' => [
                ['value' => 'PACKAGING_EVALUATION', 'label' => 'Packaging Evaluation'],
                ['value' => 'PRICE_SENSITIVITY', 'label' => 'Price Sensitivity Study'],
                ['value' => 'PRODUCT_INTENT', 'label' => 'Product Intent Study'],
                ['value' => 'CONSUMER_USAGE_HABIT', 'label' => 'Consumer Usage & Habit Study'],
            ],
            'sensoryStudyTypes' => [
                ['value' => 'DISCRIMINATIVE', 'label' => 'Discriminative'],
                ['value' => 'DESCRIPTIVE', 'label' => 'Descriptive'],
                ['value' => 'CONSUMER_TEST', 'label' => 'Consumer Test'],
            ],
            'consumerObjectives' => [
                ['value' => 'MARKET_READINESS', 'label' => 'Market Readiness', 'panelCount' => 100, 'bufferCount' => 0, 'defaultTarget' => 100],
                ['value' => 'REFINEMENT', 'label' => 'Refinement', 'panelCount' => 50, 'bufferCount' => 0, 'defaultTarget' => 50],
                ['value' => 'PROTOTYPING', 'label' => 'Prototyping', 'panelCount' => 25, 'bufferCount' => 10, 'defaultTarget' => 35],
            ],
            'attributeDimensions' => ['Appearance', 'Aroma', 'Texture', 'Taste', 'mouthfeel', 'Flavor', 'aftertaste'],
            'regions' => [],
            'facilitiesByRegion' => [],
            'targetConsumerOptions' => [
                'genders' => ['MALE', 'FEMALE', 'NON_BINARY', 'PREFER_NOT_SAY'],
                'lifestyles' => ['student', 'athlete', 'office_worker'],
                'dietaryPrefs' => ['VEGETARIAN', 'VEGAN', 'GLUTEN_FREE'],
                'consumptionHabits' => ['coffeeDrinker', 'snackConsumer', 'energyDrinkConsumer'],
            ],
        ];
    }

    private function serializeStudy(Study $study): array
    {
        return [
            'id' => $study->id,
            'title' => $study->title,
            'productName' => $study->productName,
            'creatorId' => $study->creatorId,
            'location' => $study->location,
            'category' => $study->category,
            'stage' => $study->stage,
            'status' => $study->status,
            'sampleSize' => $study->sampleSize,
            'description' => $study->description,
            'createdAt' => DateService::iso($study->createdAt),
            'updatedAt' => DateService::iso($study->updatedAt),
            'responseCount' => (int) ($study->responses_count ?? 0),
            'participantCount' => (int) ($study->participants_count ?? 0),
            'targetReached' => (int) ($study->responses_count ?? 0) >= (int) $study->sampleSize,
            'participants' => $study->participants->map(fn ($participant) => [
                'id' => $participant->id,
                'status' => $participant->status,
                'completedAt' => DateService::iso($participant->completedAt),
                'panelistName' => $participant->panelist?->name,
            ])->all(),
            'links' => [
                'form' => "/studies/{$study->id}/form",
                'dashboard' => "/dashboard/{$study->id}",
            ],
        ];
    }
}
