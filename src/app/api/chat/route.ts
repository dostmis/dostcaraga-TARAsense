import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentSession } from "@/lib/auth/session";
import { buildTarasenseChatSystemPrompt, TARASENSE_CHATBOT_STARTER_TOPICS } from "@/lib/chatbot/system-prompt";
import { createOpenAICompatibleClient, hasConfiguredAiProvider } from "@/lib/ai/openai-compatible";
import { checkRateLimit, CHAT_RATE_LIMIT } from "@/lib/rate-limit";

export const runtime = "nodejs";

const ChatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1).max(1600),
});

const ChatRequestSchema = z.object({
  messages: z.array(ChatMessageSchema).min(1).max(12),
  context: z
    .object({
      pathname: z.string().trim().max(180).optional(),
    })
    .optional(),
});

type ChatMessage = z.infer<typeof ChatMessageSchema>;

export async function GET() {
  return NextResponse.json({
    status: "ready",
    mode: getChatMode(),
    topics: TARASENSE_CHATBOT_STARTER_TOPICS,
  });
}

export async function POST(request: NextRequest) {
  try {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    const session = await getCurrentSession();
    const rateLimitKey = session?.userId ? `chat:user:${session.userId}` : `chat:ip:${ip}`;
    const rateLimitResult = checkRateLimit(rateLimitKey, CHAT_RATE_LIMIT);
    if (!rateLimitResult.allowed) {
      return NextResponse.json({ error: "Too many requests. Please slow down." }, { status: 429 });
    }

    const payload = await readJson(request);
    const parsed = ChatRequestSchema.safeParse(payload);

    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid chat request." }, { status: 400 });
    }

    const latestUserMessage = [...parsed.data.messages].reverse().find((message) => message.role === "user");
    if (!latestUserMessage) {
      return NextResponse.json({ error: "A user message is required." }, { status: 400 });
    }

    const role = session?.role ?? "PUBLIC";
    const systemPrompt = buildTarasenseChatSystemPrompt({
      role,
      pathname: parsed.data.context?.pathname,
    });

    if (getChatMode() !== "live") {
      return NextResponse.json({
        mode: "preview",
        message: buildPreviewReply(latestUserMessage.content, role),
      });
    }

    const message = await generateLiveReply({
      systemPrompt,
      messages: parsed.data.messages,
    });

    return NextResponse.json({ mode: "live", message });
  } catch (error) {
    console.error("TARAsense chatbot request failed:", error);
    return NextResponse.json({ error: "Chatbot request failed." }, { status: 500 });
  }
}

async function readJson(request: NextRequest) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function getChatMode() {
  return process.env.TARASENSE_CHATBOT_LIVE === "1" && hasConfiguredAiProvider() ? "live" : "preview";
}

function buildPreviewReply(message: string, role: string) {
  const normalized = message.toLowerCase();

  if (normalized.includes("jar") || normalized.includes("penalty")) {
    return "JAR means Just-About-Right. In TARAsense, JAR results help show whether an attribute is too low, just right, or too high. Penalty analysis connects those attribute issues to overall liking so MSMEs can prioritize product improvements.";
  }

  if (normalized.includes("study") || normalized.includes("create")) {
    return "To create a TARAsense study, an MSME starts from the study builder, defines product details, target participants, sensory attributes, screening rules, and scheduling needs. Keep the setup aligned with the product stage so the dashboard analysis remains meaningful.";
  }

  if (normalized.includes("fic") || normalized.includes("schedule") || normalized.includes("book")) {
    return "FIC-related workflows depend on facility assignment and availability. TARAsense should only show or use facility schedules that the signed-in role is allowed to access.";
  }

  if (normalized.includes("result") || normalized.includes("dashboard") || normalized.includes("analysis")) {
    return "TARAsense dashboards summarize sensory responses, liking scores, attribute diagnostics, and readiness signals. For private study-specific interpretation, the live assistant must first receive authorized study context from the server.";
  }

  if (normalized.includes("participant") || normalized.includes("consumer") || normalized.includes("guest") || normalized.includes("qr")) {
    return "TARAsense supports registered consumers and guest participants. Screening, QR check-in, and response submission should always preserve participant privacy and only collect data required for the active study.";
  }

  return `The TARAsense assistant interface and API are ready in preview mode for your ${role} context. Live AI responses are disabled until TARASENSE_CHATBOT_LIVE=1 and a server-side AI provider API key are configured. I can help with study setup, FIC coordination, participant workflows, JAR/penalty analysis, and dashboard interpretation.`;
}

async function generateLiveReply(input: { systemPrompt: string; messages: ChatMessage[] }) {
  const ai = await createOpenAICompatibleClient("chat");
  if (!ai) {
    return "Live AI responses are not configured yet.";
  }

  const completion = await ai.client.chat.completions.create({
    model: ai.model,
    messages: [
      { role: "system", content: input.systemPrompt },
      ...input.messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
    ],
    temperature: 0.1,
    max_tokens: 1000,
  });

  return completion.choices[0]?.message?.content?.trim() || "I could not generate a response. Please try again.";
}
