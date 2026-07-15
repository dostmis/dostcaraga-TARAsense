"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Beaker, Check, ListOrdered, MessageSquareText, Star } from "lucide-react";
import { deleteResponseDraft, getResponseDraft, saveResponseDraft, submitResponse } from "@/app/actions/response-actions";
import type { CustomAnswers, CustomAnswerValue, CustomQuestion } from "@/lib/custom-questions";

type AttributeType = "OVERALL_LIKING" | "ATTRIBUTE_LIKING" | "JAR" | "OPEN_ENDED";
type EvaluationPhase = "instructions" | "sample" | "ranking" | "comments";

interface SensoryAttribute {
  id: string;
  name: string;
  type: AttributeType;
  sourceAttributeName?: string | null;
  jarOptions?: {
    low?: string;
    midLow?: string;
    mid?: string;
    midHigh?: string;
    high?: string;
    labels?: string[];
  } | null;
}

interface SampleStep {
  type: "JAR" | "ATTRIBUTE_LIKING" | "OVERALL_LIKING";
  baseName: string;
  attribute: SensoryAttribute;
}

interface SamplePlanItem {
  sampleNumber: number;
  servingOrder: number;
  code: string;
}

interface TestInterfaceProps {
  studyId: string;
  participantId: string;
  attributes: SensoryAttribute[];
  customQuestions?: CustomQuestion[];
  productName: string;
  sampleCount?: number;
  samplePlan?: SamplePlanItem[];
}

interface FinalComments {
  likedMost: string;
  improvements: string;
}

interface EvaluationDraftPayload {
  phase: EvaluationPhase;
  currentSampleIndex: number;
  currentStep: number;
  responsesBySample: Record<number, Record<string, unknown>>;
  sampleRanking: Record<number, number | null>;
  comments: FinalComments;
  customAnswers: CustomAnswers;
  samplePlanSignature: string;
  updatedAt: string;
}

export function SensoryTestInterface({
  studyId,
  participantId,
  attributes,
  customQuestions = [],
  productName,
  sampleCount = 1,
  samplePlan,
}: TestInterfaceProps) {
  const normalizedSamplePlan = useMemo(
    () => normalizeSamplePlan(samplePlan, sampleCount),
    [samplePlan, sampleCount]
  );
  const samplePlanSignature = useMemo(
    () =>
      JSON.stringify({
        samples: normalizedSamplePlan.map((sample) => ({
          sampleNumber: sample.sampleNumber,
          servingOrder: sample.servingOrder,
          code: sample.code,
        })),
        attributes: attributes.map((attribute) => ({
          id: attribute.id,
          name: attribute.name,
          type: attribute.type,
          sourceAttributeName: attribute.sourceAttributeName ?? null,
        })),
      }),
    [attributes, normalizedSamplePlan]
  );
  const totalSamples = normalizedSamplePlan.length;
  const sampleSteps = useMemo(() => buildSampleSteps(attributes), [attributes]);
  const openEndedQuestions = useMemo(
    () => attributes.filter((attribute) => attribute.type === "OPEN_ENDED"),
    [attributes]
  );
  const [phase, setPhase] = useState<EvaluationPhase>("instructions");
  const [currentSampleIndex, setCurrentSampleIndex] = useState(0);
  const [currentStep, setCurrentStep] = useState(0);
  const [responsesBySample, setResponsesBySample] = useState<Record<number, Record<string, unknown>>>({});
  const [sampleRanking, setSampleRanking] = useState<Record<number, number | undefined>>({});
  const [comments, setComments] = useState<FinalComments>({ likedMost: "", improvements: "" });
  const [customAnswers, setCustomAnswers] = useState<CustomAnswers>({});
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftReady, setDraftReady] = useState(false);
  const latestDraftRef = useRef<EvaluationDraftPayload | null>(null);
  const router = useRouter();

  const currentStepConfig = sampleSteps[currentStep];
  const currentResponses = responsesBySample[currentSampleIndex] ?? {};
  const currentSample = normalizedSamplePlan[currentSampleIndex] ?? normalizedSamplePlan[0];
  const nextSample = normalizedSamplePlan[Math.min(currentSampleIndex + 1, totalSamples - 1)] ?? currentSample;
  const isLastStepInSample = currentStep === sampleSteps.length - 1;
  const isLastSample = currentSampleIndex === totalSamples - 1;
  const isCooldownActive = cooldownSeconds > 0;
  const requiresRanking = totalSamples > 1;
  const localDraftKey = useMemo(
    () => `tarasense-response-draft:${studyId}:${participantId}`,
    [participantId, studyId]
  );

  useEffect(() => {
    if (cooldownSeconds <= 0) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setCooldownSeconds((previous) => {
        if (previous <= 1) {
          setCurrentSampleIndex((sampleIndex) => Math.min(sampleIndex + 1, totalSamples - 1));
          setCurrentStep(0);
          return 0;
        }
        return previous - 1;
      });
    }, 1000);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [cooldownSeconds, totalSamples]);

  useEffect(() => {
    let cancelled = false;

    const restoreDraft = async () => {
      const localDraft = readLocalEvaluationDraft(localDraftKey, samplePlanSignature);
      const serverResult = await getResponseDraft(studyId, participantId);
      const serverDraft =
        serverResult.success && serverResult.draft
          ? normalizeEvaluationDraft(serverResult.draft, samplePlanSignature)
          : null;
      const selectedDraft = chooseNewestDraft(localDraft, serverDraft);

      if (cancelled) {
        return;
      }

      if (selectedDraft) {
        applyEvaluationDraft(selectedDraft, {
          totalSamples,
          sampleStepCount: sampleSteps.length,
          setPhase,
          setCurrentSampleIndex,
          setCurrentStep,
          setResponsesBySample,
          setSampleRanking,
          setComments,
          setCustomAnswers,
        });
      }
      setDraftReady(true);
    };

    void restoreDraft();

    return () => {
      cancelled = true;
    };
  }, [localDraftKey, participantId, samplePlanSignature, sampleSteps.length, studyId, totalSamples]);

  useEffect(() => {
    if (!draftReady || isSubmitting) {
      return;
    }

    const draft = buildEvaluationDraft({
      phase,
      currentSampleIndex,
      currentStep,
      responsesBySample,
      sampleRanking,
      comments,
      customAnswers,
      samplePlanSignature,
    });
    latestDraftRef.current = draft;
    writeLocalEvaluationDraft(localDraftKey, draft);

    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      return;
    }

    const timeout = window.setTimeout(() => {
      void saveResponseDraft(studyId, participantId, draft);
    }, 900);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [
    comments,
    customAnswers,
    currentSampleIndex,
    currentStep,
    draftReady,
    isSubmitting,
    localDraftKey,
    participantId,
    phase,
    responsesBySample,
    samplePlanSignature,
    sampleRanking,
    studyId,
  ]);

  useEffect(() => {
    const syncDraft = () => {
      const draft = latestDraftRef.current;
      if (!draft) {
        return;
      }
      void saveResponseDraft(studyId, participantId, draft);
    };

    window.addEventListener("online", syncDraft);
    return () => {
      window.removeEventListener("online", syncDraft);
    };
  }, [participantId, studyId]);

  const handleValueChange = (attributeName: string, value: unknown) => {
    setResponsesBySample((previous) => ({
      ...previous,
      [currentSampleIndex]: {
        ...(previous[currentSampleIndex] ?? {}),
        [attributeName]: value,
      },
    }));
  };

  const handleCustomAnswerChange = (questionId: string, value: string | string[]) => {
    setCustomAnswers((previous) => ({ ...previous, [questionId]: value }));
  };

  const handleNext = () => {
    if (isCooldownActive || phase !== "sample") {
      return;
    }

    if (!isSampleStepAnswered(currentStepConfig, currentResponses)) {
      setError("Please answer this item before continuing.");
      return;
    }

    setError(null);
    if (isLastStepInSample) {
      if (!isLastSample) {
        setCooldownSeconds(30);
        return;
      }
      setPhase(requiresRanking ? "ranking" : "comments");
      return;
    }

    setCurrentStep((prev) => prev + 1);
  };

  const handleRankingChange = (sampleNumber: number, rank: number) => {
    setSampleRanking((previous) => ({
      ...previous,
      [sampleNumber]: rank,
    }));
  };

  const handleRankingNext = () => {
    const validation = validateRanking(sampleRanking, normalizedSamplePlan);
    if (!validation.valid) {
      setError(validation.error);
      return;
    }

    setError(null);
    setPhase("comments");
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    setError(null);

    const overallLikingEntry = attributes.find((attribute) => attribute.type === "OVERALL_LIKING");
    const sampleResponses = normalizedSamplePlan.map((sample, index) => {
      const attributeValues = responsesBySample[index] ?? {};
      return {
        sampleNumber: sample.sampleNumber,
        sampleLabel: `Sample ${sample.sampleNumber}`,
        overallLiking:
          overallLikingEntry && typeof attributeValues[overallLikingEntry.name] === "number"
            ? (attributeValues[overallLikingEntry.name] as number)
            : undefined,
        attributes: attributeValues,
      };
    });

    const payload = buildMultiSamplePayload(attributes, sampleResponses, comments);
    if (!payload) {
      setIsSubmitting(false);
      setError("Incomplete sample responses. Please answer all required sections before submitting.");
      return;
    }

    const rankingRows = requiresRanking
      ? buildRankingRows(sampleRanking, normalizedSamplePlan)
      : undefined;
    if (requiresRanking && !rankingRows) {
      setIsSubmitting(false);
      setError("Complete the sample ranking before submitting.");
      return;
    }

    const missingRequired = customQuestions.find((question) => {
      if (!question.required) {
        return false;
      }
      const answer = customAnswers[question.id];
      return question.type === "CHECKBOXES"
        ? !Array.isArray(answer) || answer.length === 0
        : typeof answer !== "string" || answer.trim().length === 0;
    });
    if (missingRequired) {
      setIsSubmitting(false);
      setError(`Please answer: "${missingRequired.text}".`);
      return;
    }

    const result = await submitResponse(studyId, participantId, {
      overallLiking: payload.overallLiking,
      attributes: payload.attributes,
      sampleResponses: payload.sampleResponses,
      sampleRanking: rankingRows,
      comments,
      customAnswers,
      submittedAt: new Date().toISOString(),
    });

    setIsSubmitting(false);

    if (!result.success) {
      if ((result.error ?? "").toLowerCase().includes("already submitted")) {
        removeLocalEvaluationDraft(localDraftKey);
        await deleteResponseDraft(studyId, participantId);
        router.push(`/test/completed?studyId=${studyId}`);
        return;
      }
      setError(result.error ?? "Submission failed.");
      return;
    }

    removeLocalEvaluationDraft(localDraftKey);
    await deleteResponseDraft(studyId, participantId);
    router.push(`/test/completed?studyId=${studyId}`);
  };

  if (sampleSteps.length === 0) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f8fafc] px-4">
        <div className="w-full max-w-md rounded-xl border border-[#e2e8f0] bg-white p-6 text-center shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
          <h1 className="text-xl font-semibold text-[#0f172a]">No sensory attributes configured</h1>
          <p className="mt-2 text-[#64748b]">This study cannot run until evaluation questions are added.</p>
        </div>
      </div>
    );
  }

  const totalProgressSteps = 1 + sampleSteps.length * totalSamples + (requiresRanking ? 1 : 0) + 1;
  const progressStep = getProgressStep({
    phase,
    currentSampleIndex,
    currentStep,
    sampleStepCount: sampleSteps.length,
    totalSamples,
    requiresRanking,
  });
  const progress = Math.max(1, Math.min(100, Math.round((progressStep / totalProgressSteps) * 100)));

  return (
    <div className="min-h-screen bg-[#f8fafc]">
      <header className="sticky top-0 z-10 border-b border-[#e2e8f0] bg-white px-4 py-3">
        <div className="mx-auto flex w-full max-w-md items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#f97316]">
              <Beaker className="h-3.5 w-3.5 text-white" />
            </div>
            <span className="text-xs text-[#64748b]">{productName}</span>
          </div>
          <span className="text-xs text-[#64748b]">{getHeaderStatus(phase, currentSampleIndex, totalSamples, normalizedSamplePlan)}</span>
        </div>
        <p className="mx-auto mt-2 w-full max-w-md text-xs text-[#64748b]">
          {isCooldownActive
            ? `Resting period before ${formatSampleDisplay(nextSample)}`
            : getPhaseLabel(phase, currentStep, sampleSteps.length)}
        </p>
        <div className="mx-auto mt-2 h-1 w-full max-w-md overflow-hidden rounded-full bg-[#e2e8f0]">
          <div className="h-full rounded-full bg-[#f97316] transition-all" style={{ width: `${progress}%` }} />
        </div>
      </header>

      <main className="mx-auto w-full max-w-md p-0 sm:p-4">
        {phase === "instructions" && (
          <InstructionsPanel
            productName={productName}
            totalSamples={totalSamples}
            onStart={() => {
              setError(null);
              setPhase("sample");
            }}
          />
        )}

        {phase === "sample" && (
          isCooldownActive ? (
            <CooldownPanel
              currentSampleIndex={currentSampleIndex}
              totalSamples={totalSamples}
              cooldownSeconds={cooldownSeconds}
              currentSampleLabel={formatSampleDisplay(currentSample)}
              nextSampleLabel={formatSampleDisplay(nextSample)}
            />
          ) : (
            <section className="min-h-[calc(100dvh-5.5rem)] space-y-6 rounded-none border-x-0 border-y border-[#e2e8f0] bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.06)] sm:min-h-0 sm:rounded-xl sm:border sm:p-6">
              <div className="text-center">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[#fff7ed] px-3 py-1 text-xs font-medium text-[#ea580c]">
                  <Star className="h-3 w-3" />
                  {currentStepConfig?.type === "OVERALL_LIKING"
                    ? "Overall Liking"
                    : currentStepConfig?.type === "JAR"
                      ? "JAR"
                      : "Attribute Liking"}
                </span>
                <p className="mt-3 text-xs font-medium uppercase tracking-wide text-[#64748b]">
                  {formatSampleDisplay(currentSample)}
                </p>
                <h2 className="mt-1 text-lg font-semibold text-[#0f172a]">
                  {currentStepConfig?.type === "OVERALL_LIKING" ? "Overall Liking" : currentStepConfig?.baseName}
                </h2>
              </div>

              <div>{renderSampleScale(currentStepConfig, currentResponses, handleValueChange)}</div>

              {error && <p className="text-center text-sm text-red-600">{error}</p>}

              <button
                onClick={handleNext}
                disabled={!isSampleStepAnswered(currentStepConfig, currentResponses) || isSubmitting}
                className="w-full rounded-lg border border-[#ea580c] bg-[#f97316] py-3 text-base font-semibold text-white transition hover:bg-[#ea580c] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isLastStepInSample
                  ? isLastSample
                    ? requiresRanking
                      ? "Continue to Ranking"
                      : "Continue to Comments"
                    : "Finish Sample"
                  : "Next Question"}
              </button>
            </section>
          )
        )}

        {phase === "ranking" && (
          <RankingPanel
            samplePlan={normalizedSamplePlan}
            sampleRanking={sampleRanking}
            onChange={handleRankingChange}
            onNext={handleRankingNext}
            error={error}
          />
        )}

        {phase === "comments" && (
          <CommentsPanel
            productName={productName}
            comments={comments}
            openEndedQuestions={openEndedQuestions}
            customQuestions={customQuestions}
            customAnswers={customAnswers}
            onCustomAnswerChange={handleCustomAnswerChange}
            isSubmitting={isSubmitting}
            error={error}
            onChange={setComments}
            onSubmit={() => void handleSubmit()}
          />
        )}
      </main>

      {phase === "comments" && !isSubmitting && (
        <div className="pointer-events-none fixed bottom-4 left-1/2 -translate-x-1/2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
          <Check className="mr-1 inline h-3 w-3" />
          Final step
        </div>
      )}
    </div>
  );
}

function InstructionsPanel({
  productName,
  totalSamples,
  onStart,
}: {
  productName: string;
  totalSamples: number;
  onStart: () => void;
}) {
  return (
    <section className="min-h-[calc(100dvh-5.5rem)] space-y-5 rounded-none border-x-0 border-y border-[#e2e8f0] bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.06)] sm:min-h-0 sm:rounded-xl sm:border sm:p-6">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-[#ea580c]">Instructions to Panelist</p>
        <h1 className="mt-2 text-xl font-semibold text-[#0f172a]">
          You will evaluate {totalSamples} {productName} {totalSamples === 1 ? "sample" : "samples"}.
        </h1>
      </div>
      <ul className="list-disc space-y-2 pl-5 text-sm text-[#475569]">
        <li>Taste the samples in the order presented.</li>
        <li>Rinse your mouth with water between samples.</li>
        <li>There are no right or wrong answers - please rate based on your personal preference.</li>
      </ul>
      <button
        type="button"
        onClick={onStart}
        className="w-full rounded-lg border border-[#ea580c] bg-[#f97316] py-3 text-base font-semibold text-white transition hover:bg-[#ea580c]"
      >
        Start Evaluation
      </button>
    </section>
  );
}

function CooldownPanel({
  currentSampleIndex,
  totalSamples,
  cooldownSeconds,
  currentSampleLabel,
  nextSampleLabel,
}: {
  currentSampleIndex: number;
  totalSamples: number;
  cooldownSeconds: number;
  currentSampleLabel: string;
  nextSampleLabel: string;
}) {
  return (
    <section className="min-h-[calc(100dvh-5.5rem)] space-y-4 rounded-none border-x-0 border-y border-[#e2e8f0] bg-white p-5 text-center shadow-[0_1px_3px_rgba(15,23,42,0.06)] sm:min-h-0 sm:rounded-xl sm:border sm:p-6">
      <h2 className="text-lg font-semibold text-[#0f172a]">{currentSampleLabel} completed</h2>
      <p className="text-sm text-[#64748b]">
        Please wait before proceeding to {currentSampleIndex + 1 >= totalSamples ? currentSampleLabel : nextSampleLabel}.
      </p>
      <p className="text-3xl font-bold text-[#ea580c]">{cooldownSeconds}s</p>
      <p className="text-xs text-[#64748b]">Use this time to rinse your mouth with water.</p>
    </section>
  );
}

function RankingPanel({
  samplePlan,
  sampleRanking,
  onChange,
  onNext,
  error,
}: {
  samplePlan: SamplePlanItem[];
  sampleRanking: Record<number, number | undefined>;
  onChange: (sampleNumber: number, rank: number) => void;
  onNext: () => void;
  error: string | null;
}) {
  const totalSamples = samplePlan.length;
  return (
    <section className="min-h-[calc(100dvh-5.5rem)] space-y-5 rounded-none border-x-0 border-y border-[#e2e8f0] bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.06)] sm:min-h-0 sm:rounded-xl sm:border sm:p-6">
      <div className="text-center">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[#fff7ed] px-3 py-1 text-xs font-medium text-[#ea580c]">
          <ListOrdered className="h-3 w-3" />
          Ranking
        </span>
        <h2 className="mt-3 text-lg font-semibold text-[#0f172a]">After tasting {totalSamples} samples, please rank them.</h2>
        <p className="mt-1 text-sm text-[#64748b]">
          1 = Most Preferred. {totalSamples} = Least Preferred.
        </p>
      </div>

      <div className="space-y-3">
        {samplePlan.map((sample) => {
          return (
            <label key={sample.sampleNumber} className="grid grid-cols-[1fr_7rem] items-center gap-3 rounded-lg border border-[#e2e8f0] bg-[#f8fafc] p-3">
              <span className="text-sm font-medium text-[#0f172a]">{formatSampleDisplay(sample)}</span>
              <select
                value={sampleRanking[sample.sampleNumber] ?? ""}
                onChange={(event) => onChange(sample.sampleNumber, Number(event.target.value))}
                className="rounded-md border border-[#dbe3ec] bg-white px-3 py-2 text-sm outline-none focus:border-[#f97316] focus:ring-2 focus:ring-[#fed7aa]"
              >
                <option value="">Rank</option>
                {Array.from({ length: totalSamples }, (_, rankIndex) => (
                  <option key={rankIndex + 1} value={rankIndex + 1}>
                    {rankIndex + 1}
                  </option>
                ))}
              </select>
            </label>
          );
        })}
      </div>

      {error && <p className="text-center text-sm text-red-600">{error}</p>}

      <button
        type="button"
        onClick={onNext}
        className="w-full rounded-lg border border-[#ea580c] bg-[#f97316] py-3 text-base font-semibold text-white transition hover:bg-[#ea580c]"
      >
        Continue to Comments
      </button>
    </section>
  );
}

function CommentsPanel({
  productName,
  comments,
  openEndedQuestions,
  customQuestions,
  customAnswers,
  onCustomAnswerChange,
  isSubmitting,
  error,
  onChange,
  onSubmit,
}: {
  productName: string;
  comments: FinalComments;
  openEndedQuestions: SensoryAttribute[];
  customQuestions: CustomQuestion[];
  customAnswers: CustomAnswers;
  onCustomAnswerChange: (questionId: string, value: string | string[]) => void;
  isSubmitting: boolean;
  error: string | null;
  onChange: (comments: FinalComments) => void;
  onSubmit: () => void;
}) {
  return (
    <section className="min-h-[calc(100dvh-5.5rem)] space-y-5 rounded-none border-x-0 border-y border-[#e2e8f0] bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.06)] sm:min-h-0 sm:rounded-xl sm:border sm:p-6">
      <div className="text-center">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[#fff7ed] px-3 py-1 text-xs font-medium text-[#ea580c]">
          <MessageSquareText className="h-3 w-3" />
          Optional Comments
        </span>
        <h2 className="mt-3 text-lg font-semibold text-[#0f172a]">Comments</h2>
      </div>

      <div className="space-y-4">
        <label className="block space-y-2">
          <span className="text-sm font-medium text-[#0f172a]">
            {findOpenQuestion(openEndedQuestions, "like")?.name ?? `What did you like most about the ${productName}?`}
          </span>
          <textarea
            className="h-28 w-full rounded-lg border border-[#e2e8f0] bg-white p-3 text-sm text-[#0f172a] outline-none transition focus:border-[#f97316] focus:ring-2 focus:ring-[#fed7aa]"
            value={comments.likedMost}
            maxLength={2000}
            onChange={(event) => onChange({ ...comments, likedMost: event.target.value })}
          />
        </label>

        <label className="block space-y-2">
          <span className="text-sm font-medium text-[#0f172a]">
            {findOpenQuestion(openEndedQuestions, "improve")?.name ?? "What should be improved?"}
          </span>
          <textarea
            className="h-28 w-full rounded-lg border border-[#e2e8f0] bg-white p-3 text-sm text-[#0f172a] outline-none transition focus:border-[#f97316] focus:ring-2 focus:ring-[#fed7aa]"
            value={comments.improvements}
            maxLength={2000}
            onChange={(event) => onChange({ ...comments, improvements: event.target.value })}
          />
        </label>
      </div>

      {customQuestions.length > 0 && (
        <div className="space-y-5 border-t border-[#e2e8f0] pt-5">
          {customQuestions.map((question) => (
            <CustomQuestionField
              key={question.id}
              question={question}
              answer={customAnswers[question.id]}
              onChange={onCustomAnswerChange}
            />
          ))}
        </div>
      )}

      {error && <p className="text-center text-sm text-red-600">{error}</p>}

      <button
        type="button"
        onClick={onSubmit}
        disabled={isSubmitting}
        className="w-full rounded-lg border border-[#ea580c] bg-[#f97316] py-3 text-base font-semibold text-white transition hover:bg-[#ea580c] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isSubmitting ? "Submitting..." : "Submit Test"}
      </button>
    </section>
  );
}

function CustomQuestionField({
  question,
  answer,
  onChange,
}: {
  question: CustomQuestion;
  answer: CustomAnswerValue | undefined;
  onChange: (questionId: string, value: string | string[]) => void;
}) {
  const label = (
    <span className="text-sm font-medium text-[#0f172a]">
      {question.text}
      {question.required && <span className="ml-1 text-red-600">*</span>}
    </span>
  );

  if (question.type === "PARAGRAPH") {
    const textValue = typeof answer === "string" ? answer : "";
    return (
      <label className="block space-y-2">
        {label}
        <textarea
          className="h-28 w-full rounded-lg border border-[#e2e8f0] bg-white p-3 text-sm text-[#0f172a] outline-none transition focus:border-[#f97316] focus:ring-2 focus:ring-[#fed7aa]"
          value={textValue}
          maxLength={2000}
          onChange={(event) => onChange(question.id, event.target.value)}
        />
      </label>
    );
  }

  if (question.type === "MULTIPLE_CHOICE") {
    const selected = typeof answer === "string" ? answer : "";
    return (
      <div className="space-y-2">
        {label}
        <div className="space-y-2">
          {question.options.map((option) => (
            <label
              key={option}
              className="flex cursor-pointer items-center gap-2 rounded-lg border border-[#e2e8f0] bg-white px-3 py-2 text-sm text-[#334155] hover:bg-[#f8fafc]"
            >
              <input
                type="radio"
                name={`custom-${question.id}`}
                checked={selected === option}
                onChange={() => onChange(question.id, option)}
              />
              {option}
            </label>
          ))}
        </div>
      </div>
    );
  }

  const selectedList = Array.isArray(answer) ? answer : [];
  const toggle = (option: string) => {
    const next = selectedList.includes(option)
      ? selectedList.filter((item) => item !== option)
      : [...selectedList, option];
    onChange(question.id, next);
  };
  return (
    <div className="space-y-2">
      {label}
      <div className="space-y-2">
        {question.options.map((option) => (
          <label
            key={option}
            className="flex cursor-pointer items-center gap-2 rounded-lg border border-[#e2e8f0] bg-white px-3 py-2 text-sm text-[#334155] hover:bg-[#f8fafc]"
          >
            <input
              type="checkbox"
              checked={selectedList.includes(option)}
              onChange={() => toggle(option)}
            />
            {option}
          </label>
        ))}
      </div>
    </div>
  );
}

function renderSampleScale(
  step: SampleStep | undefined,
  currentResponses: Record<string, unknown>,
  onChange: (attributeName: string, value: unknown) => void
) {
  if (!step) return null;

  if (step.type === "OVERALL_LIKING" || step.type === "ATTRIBUTE_LIKING") {
    return (
      <LikingScale
        attribute={step.attribute}
        currentResponses={currentResponses}
        onChange={onChange}
        helpText={step.type === "OVERALL_LIKING" ? "Rate your overall liking for this sample." : "Attribute Liking"}
      />
    );
  }

  return <JarScale attribute={step.attribute} currentResponses={currentResponses} onChange={onChange} />;
}

function LikingScale({
  attribute,
  currentResponses,
  onChange,
  helpText,
}: {
  attribute: SensoryAttribute;
  currentResponses: Record<string, unknown>;
  onChange: (attributeName: string, value: unknown) => void;
  helpText: string;
}) {
  const labels = [
    "Dislike Extremely",
    "Dislike Very Much",
    "Dislike Moderately",
    "Dislike Slightly",
    "Neither",
    "Like Slightly",
    "Like Moderately",
    "Like Very Much",
    "Like Extremely",
  ];

  return (
    <div className="space-y-3">
      <p className="text-center text-sm text-[#64748b]">{helpText}</p>
      <div className="grid grid-cols-3 gap-2">
        {labels.map((label, index) => {
          const value = index + 1;
          const isSelected = currentResponses[attribute.name] === value;
          return (
            <button
              type="button"
              key={value}
              onClick={() => onChange(attribute.name, value)}
              className={`flex min-h-[4.25rem] flex-col items-center justify-center gap-1 rounded-lg border p-2 text-center transition-all ${
                isSelected
                  ? "border-[#fdba74] bg-[#fff7ed] shadow-[0_4px_12px_rgba(15,23,42,0.08)]"
                  : "border-[#e2e8f0] bg-white hover:border-[#fdba74]"
              }`}
            >
              <span className={`text-lg font-bold ${isSelected ? "text-[#ea580c]" : "text-[#0f172a]"}`}>{value}</span>
              <span className="text-[10px] leading-tight text-[#64748b]">{label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function JarScale({
  attribute,
  currentResponses,
  onChange,
}: {
  attribute: SensoryAttribute;
  currentResponses: Record<string, unknown>;
  onChange: (attributeName: string, value: unknown) => void;
}) {
  const options = attribute.jarOptions ?? {
    low: "Much too low",
    midLow: "Slightly too low",
    mid: "Just about right",
    midHigh: "Slightly too high",
    high: "Much too high",
  };

  return (
    <div className="space-y-3">
      <p className="text-center text-sm text-[#64748b]">JAR</p>
      {[
        { key: 1, label: options.low ?? "Much too low" },
        { key: 2, label: options.midLow ?? "Slightly too low" },
        { key: 3, label: options.mid ?? "Just about right" },
        { key: 4, label: options.midHigh ?? "Slightly too high" },
        { key: 5, label: options.high ?? "Much too high" },
      ].map((opt) => (
        <button
          type="button"
          key={opt.key}
          onClick={() =>
            onChange(attribute.name, {
              type: "JAR_5PT",
              rawValue: opt.key,
              bucket: collapseJarBucket(opt.key),
            })
          }
          className={`w-full rounded-lg border px-4 py-3 text-left transition-all ${
            (currentResponses[attribute.name] as { rawValue?: number } | undefined)?.rawValue === opt.key
              ? "border-[#fdba74] bg-[#fff7ed]"
              : "border-[#e2e8f0] bg-white hover:border-[#fdba74]"
          }`}
        >
          <p className="font-medium text-[#0f172a]">
            {opt.key}. {opt.label}
          </p>
        </button>
      ))}
      <p className="text-xs text-[#64748b]">Reporting rule: 1-2 = TOO LOW, 3 = JAR, 4-5 = TOO HIGH.</p>
    </div>
  );
}

function buildSampleSteps(attributes: SensoryAttribute[]) {
  const overall = attributes.find((attribute) => attribute.type === "OVERALL_LIKING");
  const likingAttributes = attributes.filter((attribute) => attribute.type === "ATTRIBUTE_LIKING");
  const jarAttributes = attributes.filter((attribute) => attribute.type === "JAR");
  const likingByBaseName = new Map<string, SensoryAttribute>();
  const jarByBaseName = new Map<string, SensoryAttribute>();
  const baseNames: string[] = [];

  const addBaseName = (baseName: string) => {
    const key = baseName.toLowerCase();
    if (!baseNames.some((name) => name.toLowerCase() === key)) {
      baseNames.push(baseName);
    }
  };

  likingAttributes.forEach((attribute) => {
    const baseName = getBaseAttributeName(attribute);
    likingByBaseName.set(baseName.toLowerCase(), attribute);
    addBaseName(baseName);
  });

  jarAttributes.forEach((attribute) => {
    const baseName = getBaseAttributeName(attribute);
    jarByBaseName.set(baseName.toLowerCase(), attribute);
    addBaseName(baseName);
  });

  const steps: SampleStep[] = [];

  baseNames.forEach((baseName) => {
    const key = baseName.toLowerCase();
    const jar = jarByBaseName.get(key);
    const liking = likingByBaseName.get(key);
    if (jar) {
      steps.push({ type: "JAR", attribute: jar, baseName });
    }
    if (liking) {
      steps.push({ type: "ATTRIBUTE_LIKING", attribute: liking, baseName });
    }
  });

  if (overall) {
    steps.push({ type: "OVERALL_LIKING", attribute: overall, baseName: overall.name });
  }

  return steps;
}

function isSampleStepAnswered(step: SampleStep | undefined, currentResponses: Record<string, unknown>) {
  if (!step) return false;
  return currentResponses[step.attribute.name] !== undefined;
}

function buildMultiSamplePayload(
  attributes: SensoryAttribute[],
  sampleResponses: Array<{
    sampleNumber: number;
    overallLiking?: number;
    attributes: Record<string, unknown>;
  }>,
  comments: FinalComments
) {
  const sampleAttributes = attributes.filter((attribute) => attribute.type !== "OPEN_ENDED");
  const overallScores: number[] = [];
  const numericBuckets: Record<string, number[]> = {};
  const jarBuckets: Record<string, Record<number, number>> = {};

  attributes.forEach((attribute) => {
    if (attribute.type === "OVERALL_LIKING" || attribute.type === "ATTRIBUTE_LIKING") {
      numericBuckets[attribute.name] = [];
    }
    if (attribute.type === "JAR") {
      jarBuckets[attribute.name] = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    }
  });

  for (const sample of sampleResponses) {
    for (const attribute of sampleAttributes) {
      const value = sample.attributes[attribute.name];
      if (value === undefined) {
        return null;
      }

      if (attribute.type === "OVERALL_LIKING" && typeof value === "number") {
        overallScores.push(value);
        numericBuckets[attribute.name].push(value);
        continue;
      }
      if (attribute.type === "ATTRIBUTE_LIKING" && typeof value === "number") {
        numericBuckets[attribute.name].push(value);
        continue;
      }
      if (attribute.type === "JAR" && value && typeof value === "object") {
        const jar = value as { rawValue?: number; value?: number };
        const rawValue = typeof jar.rawValue === "number" ? jar.rawValue : jar.value;
        if (typeof rawValue === "number" && Number.isInteger(rawValue) && rawValue >= 1 && rawValue <= 5) {
          jarBuckets[attribute.name][rawValue] += 1;
          continue;
        }
      }

      return null;
    }
  }

  if (overallScores.length !== sampleResponses.length) {
    return null;
  }

  const aggregatedAttributes: Record<string, unknown> = {};
  attributes.forEach((attribute) => {
    if (attribute.type === "OVERALL_LIKING" || attribute.type === "ATTRIBUTE_LIKING") {
      const values = numericBuckets[attribute.name] ?? [];
      if (values.length > 0) {
        aggregatedAttributes[attribute.name] = roundToTwo(values.reduce((sum, score) => sum + score, 0) / values.length);
      }
      return;
    }
    if (attribute.type === "JAR") {
      const bucket = jarBuckets[attribute.name];
      const rawValue = chooseRepresentativeJarValue(bucket);
      if (rawValue !== null) {
        aggregatedAttributes[attribute.name] = {
          type: "JAR_5PT",
          rawValue,
          bucket: collapseJarBucket(rawValue),
        };
      }
      return;
    }
    if (attribute.type === "OPEN_ENDED") {
      aggregatedAttributes[attribute.name] = resolveOpenEndedAnswer(attribute, comments);
    }
  });

  return {
    overallLiking: roundToTwo(overallScores.reduce((sum, score) => sum + score, 0) / overallScores.length),
    attributes: aggregatedAttributes,
    sampleResponses,
  };
}

function resolveOpenEndedAnswer(attribute: SensoryAttribute, comments: FinalComments) {
  const name = attribute.name.toLowerCase();
  if (name.includes("like")) {
    return comments.likedMost.trim();
  }
  if (name.includes("improve") || name.includes("improved")) {
    return comments.improvements.trim();
  }
  return comments.improvements.trim() || comments.likedMost.trim();
}

function buildRankingRows(sampleRanking: Record<number, number | undefined>, samplePlan: SamplePlanItem[]) {
  const validation = validateRanking(sampleRanking, samplePlan);
  if (!validation.valid) {
    return null;
  }

  return samplePlan.map((sample) => ({
    sampleNumber: sample.sampleNumber,
    rank: sampleRanking[sample.sampleNumber] as number,
  }));
}

function validateRanking(sampleRanking: Record<number, number | undefined>, samplePlan: SamplePlanItem[]) {
  const totalSamples = samplePlan.length;
  const ranks = samplePlan.map((sample) => sampleRanking[sample.sampleNumber]);
  if (ranks.some((rank) => !Number.isInteger(rank) || (rank as number) < 1 || (rank as number) > totalSamples)) {
    return { valid: false as const, error: "Assign a rank to every sample." };
  }

  if (new Set(ranks).size !== totalSamples) {
    return { valid: false as const, error: "Each rank can only be used once." };
  }

  return { valid: true as const, error: "" };
}

function buildEvaluationDraft(input: {
  phase: EvaluationPhase;
  currentSampleIndex: number;
  currentStep: number;
  responsesBySample: Record<number, Record<string, unknown>>;
  sampleRanking: Record<number, number | undefined>;
  comments: FinalComments;
  customAnswers: CustomAnswers;
  samplePlanSignature: string;
}): EvaluationDraftPayload {
  const normalizedRanking: Record<number, number | null> = {};
  Object.entries(input.sampleRanking).forEach(([sampleNumber, rank]) => {
    normalizedRanking[Number(sampleNumber)] = typeof rank === "number" ? rank : null;
  });

  return {
    phase: input.phase,
    currentSampleIndex: input.currentSampleIndex,
    currentStep: input.currentStep,
    responsesBySample: input.responsesBySample,
    sampleRanking: normalizedRanking,
    comments: input.comments,
    customAnswers: input.customAnswers,
    samplePlanSignature: input.samplePlanSignature,
    updatedAt: new Date().toISOString(),
  };
}

function readLocalEvaluationDraft(key: string, samplePlanSignature: string) {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      return null;
    }
    return normalizeEvaluationDraft(JSON.parse(raw), samplePlanSignature);
  } catch {
    return null;
  }
}

function writeLocalEvaluationDraft(key: string, draft: EvaluationDraftPayload) {
  try {
    window.localStorage.setItem(key, JSON.stringify(draft));
  } catch {
    // Local drafts are best-effort; the server draft remains the durable copy.
  }
}

function removeLocalEvaluationDraft(key: string) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Ignore storage cleanup failures.
  }
}

function chooseNewestDraft(left: EvaluationDraftPayload | null, right: EvaluationDraftPayload | null) {
  if (!left) return right;
  if (!right) return left;
  return new Date(right.updatedAt).getTime() > new Date(left.updatedAt).getTime() ? right : left;
}

function normalizeEvaluationDraft(value: unknown, samplePlanSignature: string): EvaluationDraftPayload | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const row = value as Partial<EvaluationDraftPayload>;
  if (
    row.samplePlanSignature !== samplePlanSignature ||
    !isEvaluationPhase(row.phase) ||
    typeof row.currentSampleIndex !== "number" ||
    typeof row.currentStep !== "number" ||
    !row.updatedAt ||
    Number.isNaN(new Date(row.updatedAt).getTime())
  ) {
    return null;
  }

  return {
    phase: row.phase,
    currentSampleIndex: Math.max(0, Math.floor(row.currentSampleIndex)),
    currentStep: Math.max(0, Math.floor(row.currentStep)),
    responsesBySample: normalizeDraftResponseRows(row.responsesBySample),
    sampleRanking: normalizeDraftRanking(row.sampleRanking),
    comments: {
      likedMost: typeof row.comments?.likedMost === "string" ? row.comments.likedMost : "",
      improvements: typeof row.comments?.improvements === "string" ? row.comments.improvements : "",
    },
    customAnswers: normalizeDraftCustomAnswers(row.customAnswers),
    samplePlanSignature,
    updatedAt: row.updatedAt,
  };
}

function normalizeDraftCustomAnswers(value: unknown): CustomAnswers {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const output: CustomAnswers = {};
  for (const [questionId, answer] of Object.entries(value as Record<string, unknown>)) {
    if (typeof answer === "string") {
      output[questionId] = answer;
    } else if (Array.isArray(answer)) {
      output[questionId] = answer.filter((item): item is string => typeof item === "string");
    }
  }
  return output;
}

function applyEvaluationDraft(
  draft: EvaluationDraftPayload,
  options: {
    totalSamples: number;
    sampleStepCount: number;
    setPhase: (phase: EvaluationPhase) => void;
    setCurrentSampleIndex: (index: number) => void;
    setCurrentStep: (step: number) => void;
    setResponsesBySample: (responses: Record<number, Record<string, unknown>>) => void;
    setSampleRanking: (ranking: Record<number, number | undefined>) => void;
    setComments: (comments: FinalComments) => void;
    setCustomAnswers: (answers: CustomAnswers) => void;
  }
) {
  options.setPhase(draft.phase);
  options.setCurrentSampleIndex(Math.min(draft.currentSampleIndex, Math.max(options.totalSamples - 1, 0)));
  options.setCurrentStep(Math.min(draft.currentStep, Math.max(options.sampleStepCount - 1, 0)));
  options.setResponsesBySample(draft.responsesBySample);
  options.setSampleRanking(
    Object.fromEntries(
      Object.entries(draft.sampleRanking).map(([sampleNumber, rank]) => [Number(sampleNumber), typeof rank === "number" ? rank : undefined])
    ) as Record<number, number | undefined>
  );
  options.setComments(draft.comments);
  options.setCustomAnswers(draft.customAnswers);
}

function normalizeDraftResponseRows(value: unknown): Record<number, Record<string, unknown>> {
  if (!value || typeof value !== "object") {
    return {};
  }
  const rows: Record<number, Record<string, unknown>> = {};
  Object.entries(value as Record<string, unknown>).forEach(([sampleIndex, responseRow]) => {
    const index = Number(sampleIndex);
    if (!Number.isInteger(index) || index < 0 || !responseRow || typeof responseRow !== "object") {
      return;
    }
    rows[index] = responseRow as Record<string, unknown>;
  });
  return rows;
}

function normalizeDraftRanking(value: unknown): Record<number, number | null> {
  if (!value || typeof value !== "object") {
    return {};
  }
  const ranking: Record<number, number | null> = {};
  Object.entries(value as Record<string, unknown>).forEach(([sampleNumber, rank]) => {
    const sample = Number(sampleNumber);
    if (!Number.isInteger(sample) || sample < 1) {
      return;
    }
    ranking[sample] = typeof rank === "number" && Number.isInteger(rank) ? rank : null;
  });
  return ranking;
}

function isEvaluationPhase(value: unknown): value is EvaluationPhase {
  return value === "instructions" || value === "sample" || value === "ranking" || value === "comments";
}

function getProgressStep(input: {
  phase: EvaluationPhase;
  currentSampleIndex: number;
  currentStep: number;
  sampleStepCount: number;
  totalSamples: number;
  requiresRanking: boolean;
}) {
  if (input.phase === "instructions") {
    return 1;
  }

  const sampleBlockEnd = 1 + input.sampleStepCount * input.totalSamples;
  if (input.phase === "sample") {
    return 1 + input.currentSampleIndex * input.sampleStepCount + input.currentStep + 1;
  }
  if (input.phase === "ranking") {
    return sampleBlockEnd + 1;
  }
  return sampleBlockEnd + (input.requiresRanking ? 2 : 1);
}

function getHeaderStatus(
  phase: EvaluationPhase,
  currentSampleIndex: number,
  totalSamples: number,
  samplePlan: SamplePlanItem[]
) {
  if (phase === "instructions") return "Instructions";
  if (phase === "ranking") return "Ranking";
  if (phase === "comments") return "Comments";
  const sample = samplePlan[Math.min(currentSampleIndex, totalSamples - 1)];
  return `${formatSampleDisplay(sample)} of ${totalSamples}`;
}

function getPhaseLabel(phase: EvaluationPhase, currentStep: number, sampleStepCount: number) {
  if (phase === "instructions") return "Read the instructions before starting.";
  if (phase === "ranking") return "Rank all tasted samples.";
  if (phase === "comments") return "Optional final comments.";
  return `Question ${currentStep + 1} of ${sampleStepCount}`;
}

function normalizeSamplePlan(samplePlan: SamplePlanItem[] | undefined, sampleCount: number): SamplePlanItem[] {
  const totalSamples = Math.max(1, Math.floor(sampleCount));
  if (Array.isArray(samplePlan) && samplePlan.length === totalSamples) {
    const seenSamples = new Set<number>();
    const normalized = samplePlan
      .map((sample, index) => ({
        sampleNumber: normalizePositiveInt(sample.sampleNumber) ?? index + 1,
        servingOrder: normalizePositiveInt(sample.servingOrder) ?? index + 1,
        code: typeof sample.code === "string" && sample.code.trim() ? sample.code.trim() : `Sample ${index + 1}`,
      }))
      .sort((left, right) => left.servingOrder - right.servingOrder);

    if (normalized.every((sample) => !seenSamples.has(sample.sampleNumber) && seenSamples.add(sample.sampleNumber))) {
      return normalized;
    }
  }

  return Array.from({ length: totalSamples }, (_, index) => ({
    sampleNumber: index + 1,
    servingOrder: index + 1,
    code: `Sample ${index + 1}`,
  }));
}

function normalizePositiveInt(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  const parsed = Math.floor(value);
  return parsed > 0 ? parsed : null;
}

function formatSampleDisplay(sample: SamplePlanItem | undefined) {
  if (!sample) {
    return "Sample";
  }
  return sample.code;
}

function findOpenQuestion(questions: SensoryAttribute[], intent: "like" | "improve") {
  return questions.find((question) => {
    const name = question.name.toLowerCase();
    if (intent === "like") {
      return name.includes("like");
    }
    return name.includes("improve") || name.includes("improved");
  });
}

function getBaseAttributeName(attribute: SensoryAttribute) {
  return (attribute.sourceAttributeName?.trim() || attribute.name.replace(/\s*\(JAR\)\s*$/i, "").trim()).trim();
}

function roundToTwo(value: number) {
  return Math.round(value * 100) / 100;
}

function chooseRepresentativeJarValue(bucket: Record<number, number>) {
  const sorted = Object.entries(bucket)
    .map(([raw, count]) => ({ raw: Number(raw), count }))
    .sort((left, right) => {
      if (right.count !== left.count) return right.count - left.count;
      return Math.abs(left.raw - 3) - Math.abs(right.raw - 3);
    });

  const top = sorted[0];
  if (!top || top.count <= 0) {
    return null;
  }
  return top.raw;
}

function collapseJarBucket(rawValue: number) {
  if (rawValue <= 2) return "too_low";
  if (rawValue === 3) return "just_right";
  return "too_high";
}
