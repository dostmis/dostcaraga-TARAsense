<?php

namespace App\Services\OpenAI;

use App\Services\RateLimitService;
use Illuminate\Support\Facades\Http;

class ChatService
{
    private const STARTER_TOPICS = [
        'Study setup',
        'FIC coordination',
        'Participant workflow',
        'JAR and penalty analysis',
        'Dashboard interpretation',
    ];

    public function status(): array
    {
        return [
            'status' => 'ready',
            'mode' => $this->mode(),
            'topics' => self::STARTER_TOPICS,
        ];
    }

    public function reply(array $messages, string $role = 'PUBLIC', ?string $pathname = null, ?string $actorKey = null): array
    {
        $rate = RateLimitService::check('chat:' . ($actorKey ?: RateLimitService::getClientIp()), RateLimitService::CHAT);
        if (!$rate['allowed']) {
            return ['ok' => false, 'status' => 429, 'error' => 'Too many requests. Please slow down.'];
        }

        $validation = $this->validateMessages($messages);
        if ($validation !== null) {
            return ['ok' => false, 'status' => 400, 'error' => $validation];
        }

        $latest = collect($messages)->reverse()->first(fn ($message) => ($message['role'] ?? null) === 'user');
        if (!$latest) {
            return ['ok' => false, 'status' => 400, 'error' => 'A user message is required.'];
        }

        if ($this->mode() !== 'live') {
            return ['ok' => true, 'mode' => 'preview', 'message' => $this->previewReply((string) $latest['content'], $role)];
        }

        $response = Http::withToken((string) env('OPENAI_API_KEY'))
            ->baseUrl(rtrim((string) env('OPENAI_BASE_URL', 'https://api.openai.com/v1'), '/'))
            ->timeout(45)
            ->post('/chat/completions', [
                'model' => env('OPENAI_CHAT_MODEL', 'gpt-4o-mini'),
                'messages' => array_merge([
                    ['role' => 'system', 'content' => $this->systemPrompt($role, $pathname)],
                ], array_map(fn ($message) => [
                    'role' => $message['role'],
                    'content' => $message['content'],
                ], $messages)),
                'temperature' => 0.1,
                'max_tokens' => 1000,
            ]);

        if (!$response->successful()) {
            return ['ok' => false, 'status' => 502, 'error' => 'Chatbot provider request failed.'];
        }

        return [
            'ok' => true,
            'mode' => 'live',
            'message' => trim((string) data_get($response->json(), 'choices.0.message.content', 'I could not generate a response. Please try again.')),
        ];
    }

    private function mode(): string
    {
        return env('TARASENSE_CHATBOT_LIVE') === '1' && strlen((string) env('OPENAI_API_KEY')) > 0 ? 'live' : 'preview';
    }

    private function validateMessages(array $messages): ?string
    {
        if (count($messages) < 1 || count($messages) > 12) {
            return 'Invalid chat request.';
        }

        foreach ($messages as $message) {
            if (!in_array($message['role'] ?? null, ['user', 'assistant'], true)) {
                return 'Invalid chat request.';
            }
            $content = trim((string) ($message['content'] ?? ''));
            if ($content === '' || mb_strlen($content) > 1600) {
                return 'Invalid chat request.';
            }
        }

        return null;
    }

    private function previewReply(string $message, string $role): string
    {
        $normalized = mb_strtolower($message);

        if (str_contains($normalized, 'jar') || str_contains($normalized, 'penalty')) {
            return 'JAR means Just-About-Right. In TARAsense, JAR results help show whether an attribute is too low, just right, or too high. Penalty analysis connects those attribute issues to overall liking so MSMEs can prioritize product improvements.';
        }
        if (str_contains($normalized, 'study') || str_contains($normalized, 'create')) {
            return 'To create a TARAsense study, an MSME starts from the study builder, defines product details, target participants, sensory attributes, screening rules, and scheduling needs.';
        }
        if (str_contains($normalized, 'fic') || str_contains($normalized, 'schedule') || str_contains($normalized, 'book')) {
            return 'FIC-related workflows depend on facility assignment and availability. TARAsense should only show or use facility schedules that the signed-in role is allowed to access.';
        }

        return "The TARAsense assistant API is ready in preview mode for your {$role} context. Live AI responses are disabled until TARASENSE_CHATBOT_LIVE=1 and a server-side AI provider API key are configured.";
    }

    private function systemPrompt(string $role, ?string $pathname): string
    {
        return "You are TARAsense assistant. Answer only about TARAsense workflows, sensory evaluation, FIC coordination, reports, dashboards, and study analysis. Role: {$role}. Path: " . ($pathname ?: 'unknown') . '. Enforce privacy and never expose unauthorized data.';
    }
}
