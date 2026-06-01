<?php

namespace Tests\Unit;

use App\Services\Auth\MobileTokenService;
use App\Services\Auth\PasswordService;
use App\Services\Auth\SessionTokenService;
use Tests\TestCase;

class AuthCompatibilityTest extends TestCase
{
    public function test_session_tokens_round_trip(): void
    {
        config(['app.key' => 'base64:' . base64_encode(str_repeat('a', 32))]);
        putenv('SESSION_SECRET=' . str_repeat('s', 32));
        $_ENV['SESSION_SECRET'] = str_repeat('s', 32);

        $token = SessionTokenService::create('user_123');
        $verified = SessionTokenService::verify($token);

        $this->assertSame('user_123', $verified['userId'] ?? null);
    }

    public function test_mobile_tokens_round_trip(): void
    {
        putenv('MOBILE_TOKEN_SECRET=' . str_repeat('m', 32));
        $_ENV['MOBILE_TOKEN_SECRET'] = str_repeat('m', 32);

        $token = MobileTokenService::createAccess('user_123');
        $verified = MobileTokenService::verify($token, 'access');

        $this->assertSame('user_123', $verified['userId'] ?? null);
    }

    public function test_password_hashes_verify_with_node_compatible_format(): void
    {
        $hash = PasswordService::hash('correct horse battery staple');

        $this->assertTrue(PasswordService::verify('correct horse battery staple', $hash));
        $this->assertFalse(PasswordService::verify('wrong password', $hash));
    }
}
