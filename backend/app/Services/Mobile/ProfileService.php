<?php

namespace App\Services\Mobile;

use App\Models\Panelist;
use App\Models\StudyParticipant;
use App\Models\User;
use App\Models\UserProfile;
use Illuminate\Support\Facades\DB;

class ProfileService
{
    private const LIFESTYLES = ['student', 'athlete', 'office_worker'];
    private const DIETARY_PREFS = ['VEGETARIAN', 'VEGAN', 'GLUTEN_FREE'];
    private const GENDERS = ['MALE', 'FEMALE', 'NON_BINARY', 'PREFER_NOT_SAY'];

    public function show(array $user): array
    {
        $panelist = Panelist::query()
            ->where('userId', $user['id'])
            ->orWhere('email', $user['email'])
            ->first();

        $profileLocation = UserProfile::query()
            ->with(['region', 'province', 'city', 'barangay'])
            ->where('userId', $user['id'])
            ->first();

        $history = $panelist
            ? StudyParticipant::query()
                ->with('study:id,title,productName,stage')
                ->where('panelistId', $panelist->id)
                ->orderByDesc('selectionOrder')
                ->limit(20)
                ->get()
            : collect();

        return [
            'user' => $this->publicUser($user),
            'panelist' => $panelist ? [
                'id' => $panelist->id,
                'age' => $panelist->age,
                'gender' => $panelist->gender,
                'location' => $panelist->location,
                'occupation' => $panelist->occupation,
                'lifestyle' => $panelist->lifestyle ?? [],
                'dietaryPrefs' => $panelist->dietaryPrefs ?? [],
                'consumptionHabits' => $panelist->consumptionHabits ?? [],
                'joinedAt' => DateService::iso($panelist->joinedAt),
                'lastActive' => DateService::iso($panelist->lastActive),
            ] : null,
            'participationHistory' => $history->map(fn ($row) => [
                'id' => $row->id,
                'status' => $row->status,
                'completedAt' => DateService::iso($row->completedAt),
                'study' => $row->study,
            ])->all(),
            'options' => [
                'lifestyles' => [
                    ['value' => 'student', 'label' => 'Student'],
                    ['value' => 'athlete', 'label' => 'Athlete'],
                    ['value' => 'office_worker', 'label' => 'Office worker'],
                ],
                'dietaryPrefs' => [
                    ['value' => 'VEGETARIAN', 'label' => 'Vegetarian'],
                    ['value' => 'VEGAN', 'label' => 'Vegan'],
                    ['value' => 'GLUTEN_FREE', 'label' => 'Gluten-free'],
                ],
                'genders' => [
                    ['value' => 'MALE', 'label' => 'Male'],
                    ['value' => 'FEMALE', 'label' => 'Female'],
                    ['value' => 'NON_BINARY', 'label' => 'Non-binary'],
                    ['value' => 'PREFER_NOT_SAY', 'label' => 'Prefer not to say'],
                ],
            ],
            'profileLocation' => $profileLocation ? $this->serializeLocation($profileLocation) : null,
        ];
    }

    public function update(array $user, array $payload): array
    {
        $name = trim((string) ($payload['name'] ?? $user['name']));
        $organization = trim((string) ($payload['organization'] ?? ''));
        $location = trim((string) ($payload['location'] ?? ''));
        $occupation = trim((string) ($payload['occupation'] ?? ''));
        $gender = strtoupper(trim((string) ($payload['gender'] ?? 'PREFER_NOT_SAY')));
        $age = (int) ($payload['age'] ?? 0);
        $lifestyles = $this->stringArray($payload['lifestyle'] ?? $payload['lifestyles'] ?? [], self::LIFESTYLES, false);
        $dietaryPrefs = $this->stringArray($payload['dietaryPrefs'] ?? [], self::DIETARY_PREFS, true);

        if (mb_strlen($name) < 2) {
            return ['ok' => false, 'status' => 400, 'error' => 'Name must be at least 2 characters.'];
        }
        if ($age < 10 || $age > 100) {
            return ['ok' => false, 'status' => 400, 'error' => 'Age must be between 10 and 100.'];
        }
        if (!in_array($gender, self::GENDERS, true)) {
            return ['ok' => false, 'status' => 400, 'error' => 'Choose a valid gender.'];
        }
        if (mb_strlen($location) < 2 || mb_strlen($occupation) < 2) {
            return ['ok' => false, 'status' => 400, 'error' => 'Location and occupation are required.'];
        }

        return DB::transaction(function () use ($user, $name, $organization, $age, $gender, $location, $occupation, $lifestyles, $dietaryPrefs, $payload) {
            $updatedUser = User::query()->findOrFail($user['id']);
            $updatedUser->fill([
                'name' => $name,
                'organization' => $organization !== '' ? $organization : null,
            ])->save();

            Panelist::query()->updateOrCreate(
                ['email' => $user['email']],
                [
                    'userId' => $user['id'],
                    'name' => $name,
                    'email' => $user['email'],
                    'age' => $age,
                    'gender' => $gender,
                    'location' => $location,
                    'occupation' => $occupation,
                    'lifestyle' => $lifestyles,
                    'workDailyLiving' => [],
                    'healthFitness' => [],
                    'foodConsumption' => [],
                    'dietaryPrefs' => $dietaryPrefs,
                    'consumptionHabits' => [
                        'coffeeDrinker' => (bool) ($payload['coffeeDrinker'] ?? false),
                        'snackConsumer' => (bool) ($payload['snackConsumer'] ?? false),
                        'energyDrinkConsumer' => (bool) ($payload['energyDrinkConsumer'] ?? false),
                        'snacks' => !empty($payload['snackConsumer']) ? 'daily' : 'weekly',
                    ],
                    'isActive' => true,
                    'isGuest' => false,
                ]
            );

            return [
                'ok' => true,
                'user' => $this->publicUser($updatedUser->toArray() + ['role' => $user['role']]),
            ];
        });
    }

    public function updateLocation(array $user, array $payload): array
    {
        $regionId = $payload['regionId'] ?? null;
        $provinceId = $payload['provinceId'] ?? null;
        $cityId = $payload['cityId'] ?? null;
        $barangayId = $payload['barangayId'] ?? null;

        if (!$regionId || !$provinceId || !$cityId || !$barangayId) {
            return ['ok' => false, 'status' => 400, 'error' => 'Complete region, province, city, and barangay are required.'];
        }

        $row = UserProfile::query()->updateOrCreate(
            ['userId' => $user['id']],
            [
                'regionId' => $regionId,
                'provinceId' => $provinceId,
                'cityId' => $cityId,
                'barangayId' => $barangayId,
                'addressDetails' => trim((string) ($payload['addressDetails'] ?? '')) ?: null,
                'completedAt' => now(),
            ]
        );

        return ['ok' => true, 'profileLocation' => $this->serializeLocation($row->load(['region', 'province', 'city', 'barangay']))];
    }

    private function publicUser(array $user): array
    {
        return [
            'id' => $user['id'],
            'email' => $user['email'],
            'name' => $user['name'],
            'role' => $user['role'],
            'organization' => $user['organization'] ?? null,
            'assignedRegion' => $user['assignedRegion'] ?? null,
            'assignedFacility' => $user['assignedFacility'] ?? null,
            'createdAt' => DateService::iso($user['createdAt'] ?? null),
            'updatedAt' => DateService::iso($user['updatedAt'] ?? null),
        ];
    }

    private function serializeLocation(UserProfile $row): array
    {
        return [
            'completedAt' => DateService::iso($row->completedAt),
            'regionId' => $row->regionId,
            'provinceId' => $row->provinceId,
            'cityId' => $row->cityId,
            'barangayId' => $row->barangayId,
            'addressDetails' => $row->addressDetails,
            'region' => $row->region,
            'province' => $row->province,
            'city' => $row->city,
            'barangay' => $row->barangay,
        ];
    }

    private function stringArray(mixed $value, array $allowed, bool $upper): array
    {
        if (!is_array($value)) {
            return [];
        }

        return array_values(array_filter(array_map(function ($item) use ($upper) {
            $text = trim((string) $item);
            return $upper ? strtoupper($text) : strtolower($text);
        }, $value), fn ($item) => in_array($item, $allowed, true)));
    }
}
