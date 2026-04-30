"use client";

import {
  Bot,
  ChevronDown,
  Loader2,
  MessageCircle,
  Send,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import type { FormEvent, KeyboardEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

type ChatRole = "assistant" | "user";

type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
};

const STARTER_PROMPTS = [
  "How do I create a sensory study?",
  "What does JAR mean?",
  "How do I interpret dashboard results?",
] as const;

const INITIAL_MESSAGE: ChatMessage = {
  id: "welcome",
  role: "assistant",
  content:
    "Hi, I am the TARAsense assistant. Ask me about study setup, FIC coordination, participants, sensory testing, or result interpretation.",
};

export function FloatingChatbot() {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([INITIAL_MESSAGE]);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const canSubmit = input.trim().length > 0 && !isSending;

  const payloadMessages = useMemo(
    () =>
      messages
        .filter((message) => message.id !== "welcome")
        .slice(-10)
        .map((message) => ({ role: message.role, content: message.content })),
    [messages]
  );

  useEffect(() => {
    if (!isOpen) return;
    messagesEndRef.current?.scrollIntoView({ block: "end" });
  }, [isOpen, messages, isSending]);

  useEffect(() => {
    if (!isOpen) return;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 120);
    return () => window.clearTimeout(timer);
  }, [isOpen]);

  async function sendMessage(nextMessage: string) {
    const trimmed = nextMessage.trim();
    if (!trimmed || isSending) return;

    const userMessage: ChatMessage = {
      id: createMessageId(),
      role: "user",
      content: trimmed,
    };

    setMessages((current) => [...current, userMessage]);
    setInput("");
    setError(null);
    setIsSending(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [...payloadMessages, { role: userMessage.role, content: userMessage.content }],
          context: { pathname: window.location.pathname },
        }),
      });

      const data = (await response.json()) as { message?: string; error?: string };
      if (!response.ok || !data.message) {
        throw new Error(data.error ?? "The assistant could not respond.");
      }

      const assistantMessage = data.message;
      setMessages((current) => [
        ...current,
        {
          id: createMessageId(),
          role: "assistant",
          content: assistantMessage,
        },
      ]);
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : "The assistant could not respond.";
      setError(message);
      setMessages((current) => [
        ...current,
        {
          id: createMessageId(),
          role: "assistant",
          content: "I could not reach the TARAsense assistant API. Please try again in a moment.",
        },
      ]);
    } finally {
      setIsSending(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendMessage(input);
  }

  function handleInputKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    if (canSubmit) {
      void sendMessage(input);
    }
  }

  return (
    <div className="tara-chatbot-root pointer-events-none fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] right-3 z-[1200] flex max-w-[calc(100vw-1.5rem)] flex-col items-end gap-3 sm:right-5 sm:max-w-[390px]">
      {isOpen && (
        <section
          role="dialog"
          aria-label="TARAsense assistant"
          className="pointer-events-auto flex max-h-[min(620px,calc(100dvh-6.75rem))] w-[calc(100vw-1.5rem)] max-w-[390px] flex-col overflow-hidden rounded-2xl border border-[var(--divider)] bg-[var(--surface)] text-[var(--foreground)] shadow-[0_24px_70px_rgba(15,23,42,0.24)]"
        >
          <header className="bg-gradient-to-br from-[#1746ff] via-[#2459ff] to-[#f97316] px-4 py-4 text-white">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/25 bg-white/15">
                  <Bot size={21} />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">TARAsense Assistant</p>
                  <p className="mt-0.5 text-xs text-white/80">Read-only workflow guidance</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/20 bg-white/10 text-white transition hover:bg-white/20"
                aria-label="Minimize chatbot"
                title="Minimize chatbot"
              >
                <ChevronDown size={17} />
              </button>
            </div>
          </header>

          <div className="flex items-center gap-2 border-b border-[var(--divider)] bg-[var(--surface-strong)] px-4 py-2.5 text-[11px] font-medium text-[var(--muted-foreground)]">
            <ShieldCheck size={14} className="shrink-0 text-[#059669]" />
            <span className="min-w-0 truncate">Role-aware answers. No database actions from chat.</span>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto bg-[var(--canvas)] px-3 py-3">
            <div className="space-y-3">
              {messages.map((message) => (
                <article key={message.id} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div
                    className={
                      message.role === "user"
                        ? "max-w-[82%] rounded-2xl rounded-br-md bg-[#1746ff] px-3.5 py-2.5 text-sm leading-6 text-white shadow-sm"
                        : "max-w-[86%] rounded-2xl rounded-bl-md border border-[var(--divider)] bg-[var(--surface)] px-3.5 py-2.5 text-sm leading-6 text-[var(--foreground)] shadow-sm"
                    }
                  >
                    <p className="whitespace-pre-line break-words">{message.content}</p>
                  </div>
                </article>
              ))}

              {messages.length === 1 && (
                <div className="grid gap-2">
                  {STARTER_PROMPTS.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      disabled={isSending}
                      onClick={() => void sendMessage(prompt)}
                      className="flex items-center gap-2 rounded-xl border border-[#fed7aa] bg-[#fff7ed] px-3 py-2 text-left text-xs font-semibold text-[#9a3412] transition hover:border-[#fdba74] hover:bg-[#ffedd5] disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      <Sparkles size={13} className="shrink-0 text-[#f97316]" />
                      <span>{prompt}</span>
                    </button>
                  ))}
                </div>
              )}

              {isSending && (
                <div className="flex justify-start">
                  <div className="inline-flex items-center gap-2 rounded-2xl rounded-bl-md border border-[var(--divider)] bg-[var(--surface)] px-3.5 py-2.5 text-sm text-[var(--muted-foreground)] shadow-sm">
                    <Loader2 size={15} className="animate-spin" />
                    Thinking
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          </div>

          {error && (
            <div className="border-t border-red-200 bg-red-50 px-4 py-2 text-xs font-medium text-red-700">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="border-t border-[var(--divider)] bg-[var(--surface)] p-3">
            <div className="flex items-end gap-2 rounded-2xl border border-[var(--input)] bg-[var(--card)] p-2 focus-within:border-[var(--ring)] focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--ring)_22%,transparent)]">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(event) => setInput(event.target.value.slice(0, 1200))}
                onKeyDown={handleInputKeyDown}
                rows={1}
                placeholder="Ask about TARAsense"
                className="max-h-24 min-h-9 flex-1 resize-none bg-transparent px-2 py-2 text-sm leading-5 text-[var(--foreground)] outline-none placeholder:text-[var(--muted-foreground)]"
                aria-label="Message TARAsense assistant"
              />
              <button
                type="submit"
                disabled={!canSubmit}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#f97316] text-white transition hover:bg-[#ea580c] disabled:cursor-not-allowed disabled:bg-[#fed7aa]"
                aria-label="Send message"
                title="Send message"
              >
                {isSending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
              </button>
            </div>
          </form>
        </section>
      )}

      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        className="pointer-events-auto inline-flex h-12 w-12 items-center justify-center rounded-full border border-[#fed7aa] bg-[#f97316] text-white shadow-[0_12px_30px_rgba(249,115,22,0.34)] transition hover:scale-105 hover:bg-[#ea580c] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#fed7aa]"
        aria-label={isOpen ? "Close TARAsense assistant" : "Open TARAsense assistant"}
        title={isOpen ? "Close TARAsense assistant" : "Open TARAsense assistant"}
      >
        {isOpen ? <X size={20} /> : <MessageCircle size={21} />}
      </button>
    </div>
  );
}

function createMessageId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
