export type StudyRandomCodeBook = {
  version: 1;
  digits: 3;
  participantCapacity: number;
  sampleCount: number;
  generatedAt: string;
  codesBySample: Array<{
    sample: number;
    codes: string[];
  }>;
};

type CodePoolPicker = {
  usedPerSample: Array<Set<string>>;
  allCodes: string[];
};

export function createStudyRandomCodeBook(participantCapacity: number, sampleCount: number): StudyRandomCodeBook {
  const safeParticipantCapacity = Math.max(1, Math.floor(participantCapacity));
  const safeSampleCount = Math.max(1, Math.floor(sampleCount));
  if (safeParticipantCapacity > 900) {
    throw new Error("Participant capacity exceeds available 3-digit code space per sample (max 900).");
  }
  if (safeSampleCount > 900) {
    throw new Error("Sample setup count exceeds available distinct 3-digit code combinations per panelist row.");
  }

  const picker: CodePoolPicker = {
    usedPerSample: Array.from({ length: safeSampleCount }, () => new Set<string>()),
    allCodes: buildThreeDigitCodes(),
  };

  const codesBySample = Array.from({ length: safeSampleCount }, (_, sampleIndex) => ({
    sample: sampleIndex + 1,
    codes: [] as string[],
  }));

  for (let participantIndex = 0; participantIndex < safeParticipantCapacity; participantIndex += 1) {
    const rowUsed = new Set<string>();
    for (let sampleIndex = 0; sampleIndex < safeSampleCount; sampleIndex += 1) {
      const selected = pickCodeForSlot({
        sampleIndex,
        rowUsed,
        picker,
      });
      rowUsed.add(selected);
      codesBySample[sampleIndex].codes.push(selected);
    }
  }

  return {
    version: 1,
    digits: 3,
    participantCapacity: safeParticipantCapacity,
    sampleCount: safeSampleCount,
    generatedAt: new Date().toISOString(),
    codesBySample,
  };
}

export function parseStudyRandomCodeBook(value: unknown): StudyRandomCodeBook | null {
  if (!isRecord(value)) return null;
  if (value.version !== 1 || value.digits !== 3) return null;

  const participantCapacity = toPositiveInt(value.participantCapacity);
  const sampleCount = toPositiveInt(value.sampleCount);
  if (!participantCapacity || !sampleCount) return null;
  if (!Array.isArray(value.codesBySample) || value.codesBySample.length !== sampleCount) return null;

  const parsed = value.codesBySample.reduce<Array<{ sample: number; codes: string[] }>>((acc, entry) => {
    if (!isRecord(entry)) return acc;
    const sample = toPositiveInt(entry.sample);
    if (!sample || !Array.isArray(entry.codes)) return acc;
    const codes = entry.codes.filter((code): code is string => typeof code === "string" && isThreeDigitCode(code));
    if (codes.length !== participantCapacity) return acc;
    acc.push({ sample, codes });
    return acc;
  }, []);

  if (parsed.length !== sampleCount) return null;

  return {
    version: 1,
    digits: 3,
    participantCapacity,
    sampleCount,
    generatedAt: typeof value.generatedAt === "string" ? value.generatedAt : new Date().toISOString(),
    codesBySample: parsed.sort((left, right) => left.sample - right.sample),
  };
}

export function assignSampleCodesFromCodeBook(
  codeBook: StudyRandomCodeBook,
  panelistNumber: number
): Array<{ sample: number; code: string }> | null {
  if (!Number.isInteger(panelistNumber) || panelistNumber < 1) {
    return null;
  }

  const index = panelistNumber - 1;
  if (index >= codeBook.participantCapacity) {
    return null;
  }

  const rows = codeBook.codesBySample.map((bucket) => ({
    sample: bucket.sample,
    code: bucket.codes[index] ?? "",
  }));

  if (rows.some((row) => !isThreeDigitCode(row.code))) {
    return null;
  }

  return rows;
}

function pickCodeForSlot(input: { sampleIndex: number; rowUsed: Set<string>; picker: CodePoolPicker }) {
  const { sampleIndex, rowUsed, picker } = input;
  const usedInSample = picker.usedPerSample[sampleIndex];

  // Randomized start index preserves random distribution while ensuring deterministic completion.
  const start = Math.floor(Math.random() * picker.allCodes.length);
  for (let offset = 0; offset < picker.allCodes.length; offset += 1) {
    const index = (start + offset) % picker.allCodes.length;
    const candidate = picker.allCodes[index];
    if (usedInSample.has(candidate)) continue;
    if (rowUsed.has(candidate)) continue;
    usedInSample.add(candidate);
    return candidate;
  }

  throw new Error("Unable to allocate additional 3-digit randomized codes for the study.");
}

function buildThreeDigitCodes() {
  return Array.from({ length: 900 }, (_, index) => String(index + 100));
}

function toPositiveInt(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const parsed = Math.floor(value);
  return parsed > 0 ? parsed : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isThreeDigitCode(value: string) {
  return /^\d{3}$/.test(value);
}
