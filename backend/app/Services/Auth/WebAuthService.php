<?php

namespace App\Services\Auth;

use App\Enums\AppRole;
use App\Models\User;
use App\Services\Mobile\DateService;

class WebAuthService
{
    public function authenticate(string $email, string $password): array
    {
        if (!SessionTokenService::isConfigured()) {
            return ['ok' => false, 'status' => 500, 'error' => 'Web authentication is not configured.', 'code' => 'AUTH_CONFIG_ERROR'];
        }

        $user = User::query()->where('email', mb_strtolower(trim($email)))->first();
        $role = AppRole::parse($user?->role ?? '');

        if (!$user || !$role || empty($user->password) || !PasswordService::verify($password, $user->password)) {
            return ['ok' => false, 'status' => 401, 'error' => 'Invalid email or password.', 'code' => 'INVALID_CREDENTIALS'];
        }

        return [
            'ok' => true,
            'token' => SessionTokenService::create($user->id),
            'user' => $this->publicUser($user, $role),
        ];
    }

    public function currentUser(?string $token): ?array
    {
        $verified = $token ? SessionTokenService::verify($token) : null;
        if (!$verified) {
            return null;
        }

        $user = User::query()->find($verified['userId']);
        $role = AppRole::parse($user?->role ?? '');

        return $user && $role ? $this->publicUser($user, $role) : null;
    }

    private function publicUser(User $user, AppRole $role): array
    {
        return [
            'id' => $user->id,
            'email' => $user->email,
            'name' => $user->name,
            'role' => $role->value,
            'organization' => $user->organization,
            'assignedRegion' => $user->assignedRegion,
            'assignedFacility' => $user->assignedFacility,
            'dashboardPath' => $role->dashboardPath(),
            'createdAt' => DateService::iso($user->createdAt),
            'updatedAt' => DateService::iso($user->updatedAt),
        ];
    }
}
