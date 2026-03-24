"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Beaker, Check, Star } from "lucide-react";
import { submitResponse } from "@/app/actions/response-actions";

type AttributeType = "OVERALL_LIKING" | "ATTRIBUTE_LIKING" | "JAR" | "OPEN_ENDED";

interface SensoryAttribute {
  id: string;
  name: string;
  type: AttributeType;
  jarOptions?: { low?: string; mid?: string; high?: string } | null;
}

interface TestInterfaceProps {
  studyId: string;
  participantId: string;
  attributes: SensoryAttribute[];
  productName: string;
  sampleCount?: number;
}

export function SensoryTestInterface({
  studyId,
  participantId,
  attributes,
  productName,
  sampleCount = 1,
}: TestInterfaceProps) {
  const totalSamples = Math.max(1, Math.floor(sampleCount));
  const [currentSampleIndex, setCurrentSampleIndex] = useState(0);
  const [currentStep, setCurrentStep] = useState(0);
  const [responsesBySample, setResponsesBySample] = useState<Record<number, Record<string, unknown>>>({});
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const currentAttr = attributes[currentStep];
  const currentResponses = responsesBySample[currentSampleIndex] ?? {};
  const isLastStepInSample = currentStep === attributes.length - 1;
  const isLastSample = currentSampleIndex === totalSamples - 1;
  const isCooldownActive = cooldownSeconds > 0;

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

  const handleValueChange = (value: unknown) => {
    if (!currentAttr) return;

    setResponsesBySample((previous) => ({
      ...previous,
      [currentSampleIndex]: {
        ...(previous[currentSampleIndex] ?? {}),
        [currentAttr.name]: value,
      },
    }));
  };

  const handleNext = () => {
    if (isCooldownActive) {
      return;
    }

    if (isLastStepInSample) {
      if (!isLastSample) {
        setCooldownSeconds(30);
        return;
      }
      void handleSubmit();
      return;
    }

    setCurrentStep((prev) => prev + 1);
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    setError(null);

    const overallLikingEntry = attributes.find((attribute) => attribute.type === "OVERALL_LIKING");
    const sampleResponses = Array.from({ length: totalSamples }, (_, index) => {
      const attributeValues = responsesBySample[index] ?? {};
      return {
        sampleNumber: index + 1,
        overallLiking:
          overallLikingEntry && typeof attributeValues[overallLikingEntry.name] === "number"
            ? (attributeValues[overallLikingEntry.name] as number)
            : undefined,
        attributes: attributeValues,
      };
    });

    const payload = buildMultiSamplePayload(attributes, sampleResponses);
    if (!payload) {
      setIsSubmitting(false);
      setError("Incomplete sample responses. Please answer all sections before submitting.");
      return;
    }

    const result = await submitResponse(studyId, participantId, {
      overallLiking: payload.overallLiking,
      attributes: payload.attributes,
      sampleResponses: payload.sampleResponses,
      submittedAt: new Date().toISOString(),
    });

    setIsSubmitting(false);

    if (!result.success) {
      if ((result.error ?? "").toLowerCase().includes("already submitted")) {
        router.push(`/test/completed?studyId=${studyId}`);
        return;
      }
      setError(result.error ?? "Submission failed.");
      return;
    }

    router.push(`/test/completed?studyId=${studyId}`);
  };

  const renderScale = () => {
    if (!currentAttr) return null;

    if (currentAttr.type === "OVERALL_LIKING" || currentAttr.type === "ATTRIBUTE_LIKING") {
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
        <div className="grid grid-cols-3 gap-2">
          {labels.map((label, index) => {
            const value = index + 1;
            const isSelected = currentResponses[currentAttr.name] === value;
            return (
              <button
                key={value}
                onClick={() => handleValueChange(value)}
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
      );
    }

    if (currentAttr.type === "JAR") {
      const options = currentAttr.jarOptions ?? {
        low: "Too Low",
        mid: "Just Right",
        high: "Too High",
      };

      return (
        <div className="space-y-3">
          {[
            { key: "too_low", label: options.low ?? "Too Low" },
            { key: "just_right", label: options.mid ?? "Just Right" },
            { key: "too_high", label: options.high ?? "Too High" },
          ].map((opt) => (
            <button
              key={opt.key}
              onClick={() => handleValueChange({ type: "JAR", value: opt.key })}
              className={`w-full rounded-lg border px-4 py-3 text-left transition-all ${
                (currentResponses[currentAttr.name] as { value?: string } | undefined)?.value === opt.key
                  ? "border-[#fdba74] bg-[#fff7ed]"
                  : "border-[#e2e8f0] bg-white hover:border-[#fdba74]"
              }`}
            >
              <p className="font-medium text-[#0f172a]">{opt.label}</p>
            </button>
          ))}
        </div>
      );
    }

    if (currentAttr.type === "OPEN_ENDED") {
      return (
        <textarea
          className="h-32 w-full rounded-lg border border-[#e2e8f0] bg-white p-3 text-sm text-[#0f172a] outline-none transition focus:border-[#f97316] focus:ring-2 focus:ring-[#fed7aa]"
          placeholder="Share your thoughts..."
          onChange={(event) => handleValueChange(event.target.value)}
          value={(currentResponses[currentAttr.name] as string | undefined) ?? ""}
        />
      );
    }

    return null;
  };

  if (attributes.length === 0 || !currentAttr) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f8fafc] px-4">
        <div className="w-full max-w-md rounded-xl border border-[#e2e8f0] bg-white p-6 text-center shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
          <h1 className="text-xl font-semibold text-[#0f172a]">No sensory attributes configured</h1>
          <p className="mt-2 text-[#64748b]">This study cannot run until attributes are added.</p>
        </div>
      </div>
    );
  }

  const totalQuestions = attributes.length * totalSamples;
  const answeredInCurrentSample = isCooldownActive ? attributes.length : currentStep + 1;
  const answeredQuestions = currentSampleIndex * attributes.length + answeredInCurrentSample;
  const progress = Math.max(1, Math.min(100, Math.round((answeredQuestions / totalQuestions) * 100)));

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
          <span className="text-xs text-[#64748b]">
            Sample {Math.min(currentSampleIndex + 1, totalSamples)} of {totalSamples}
          </span>
        </div>
        <p className="mx-auto mt-2 w-full max-w-md text-xs text-[#64748b]">
          {isCooldownActive
            ? `Resting period before Sample ${Math.min(currentSampleIndex + 2, totalSamples)}`
            : `Question ${currentStep + 1} of ${attributes.length}`}
        </p>
        <div className="mx-auto mt-2 h-1 w-full max-w-md overflow-hidden rounded-full bg-[#e2e8f0]">
          <div className="h-full rounded-full bg-[#f97316] transition-all" style={{ width: `${progress}%` }} />
        </div>
      </header>

      <main className="mx-auto w-full max-w-md p-4">
        {isCooldownActive ? (
          <section className="space-y-4 rounded-xl border border-[#e2e8f0] bg-white p-6 text-center shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
            <h2 className="text-lg font-semibold text-[#0f172a]">
              Sample {currentSampleIndex + 1} completed
            </h2>
            <p className="text-sm text-[#64748b]">
              Please wait before proceeding to Sample {Math.min(currentSampleIndex + 2, totalSamples)}.
            </p>
            <p className="text-3xl font-bold text-[#ea580c]">{cooldownSeconds}s</p>
            <p className="text-xs text-[#64748b]">
              Use this time for palate cleansing before the next sample.
            </p>
          </section>
        ) : (
          <>
            <section className="space-y-6 rounded-xl border border-[#e2e8f0] bg-white p-6 shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
              <div className="text-center">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[#fff7ed] px-3 py-1 text-xs font-medium text-[#ea580c]">
                  <Star className="h-3 w-3" />
                  {currentAttr.type.replace("_", " ")}
                </span>
                <h2 className="mt-3 text-lg font-semibold text-[#0f172a]">{currentAttr.name}</h2>
              </div>

              <div>{renderScale()}</div>

              {error && <p className="text-center text-sm text-red-600">{error}</p>}

              <button
                onClick={handleNext}
                disabled={currentResponses[currentAttr.name] === undefined || isSubmitting}
                className="w-full rounded-lg border border-[#ea580c] bg-[#f97316] py-3 text-base font-semibold text-white transition hover:bg-[#ea580c] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isLastStepInSample
                  ? isLastSample
                    ? isSubmitting
                      ? "Submitting..."
                      : "Submit Test"
                    : "Finish Sample"
                  : "Next Question"}
              </button>
            </section>
          </>
        )}
      </main>

      {isLastStepInSample && isLastSample && !isSubmitting && currentResponses[currentAttr.name] !== undefined && !isCooldownActive && (
        <div className="pointer-events-none fixed bottom-4 left-1/2 -translate-x-1/2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
          <Check className="mr-1 inline h-3 w-3" />
          Final step ready
        </div>
      )}
    </div>
  );
}

function buildMultiSamplePayload(
  attributes: SensoryAttribute[],
  sampleResponses: Array<{
    sampleNumber: number;
    overallLiking?: number;
    attributes: Record<string, unknown>;
  }>
) {
  const overallScores: number[] = [];
  const numericBuckets: Record<string, number[]> = {};
  const jarBuckets: Record<string, Record<string, number>> = {};
  const textBuckets: Record<string, string[]> = {};

  attributes.forEach((attribute) => {
    if (attribute.type === "OVERALL_LIKING" || attribute.type === "ATTRIBUTE_LIKING") {
      numericBuckets[attribute.name] = [];
    }
    if (attribute.type === "JAR") {
      jarBuckets[attribute.name] = { too_low: 0, just_right: 0, too_high: 0 };
    }
    if (attribute.type === "OPEN_ENDED") {
      textBuckets[attribute.name] = [];
    }
  });

  sampleResponses.forEach((sample) => {
    attributes.forEach((attribute) => {
      const value = sample.attributes[attribute.name];
      if (attribute.type === "OVERALL_LIKING" && typeof value === "number") {
        overallScores.push(value);
        numericBuckets[attribute.name].push(value);
        return;
      }
      if (attribute.type === "ATTRIBUTE_LIKING" && typeof value === "number") {
        numericBuckets[attribute.name].push(value);
        return;
      }
      if (attribute.type === "JAR" && value && typeof value === "object") {
        const jar = value as { value?: string };
        if (jar.value && jarBuckets[attribute.name][jar.value] !== undefined) {
          jarBuckets[attribute.name][jar.value] += 1;
        }
        return;
      }
      if (attribute.type === "OPEN_ENDED" && typeof value === "string" && value.trim().length > 0) {
        textBuckets[attribute.name].push(value.trim());
      }
    });
  });

  if (overallScores.length === 0) {
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
      const top = Object.entries(bucket).sort((left, right) => right[1] - left[1])[0];
      if (top && top[1] > 0) {
        aggregatedAttributes[attribute.name] = { type: "JAR", value: top[0] };
      }
      return;
    }
    if (attribute.type === "OPEN_ENDED") {
      const comments = textBuckets[attribute.name] ?? [];
      aggregatedAttributes[attribute.name] =
        comments.length > 0 ? comments.join(" | ") : "";
    }
  });

  return {
    overallLiking: roundToTwo(overallScores.reduce((sum, score) => sum + score, 0) / overallScores.length),
    attributes: aggregatedAttributes,
    sampleResponses,
  };
}

function roundToTwo(value: number) {
  return Math.round(value * 100) / 100;
}
