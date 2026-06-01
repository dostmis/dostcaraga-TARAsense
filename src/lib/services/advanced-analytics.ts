// Advanced exploratory sensory analytics: PCA on the attribute matrix,
// k-means consumer segmentation, and an internal-preference-mapping
// projection of samples on the consumer-preference plane.
//
// These are exploratory tools — sample sizes in Phase 1 sensory studies are
// usually small enough that the structures should be interpreted as visual
// summaries, not as confirmatory analyses. The dashboard surfaces them
// behind an explicit "Advanced exploratory analysis" header.

export interface AttributeMatrixRow {
  respondentId: string;
  sampleNumber: number;
  sampleLabel: string;
  attributes: Record<string, number>;
}

export interface PcaResult {
  attributes: string[];
  components: Array<{
    component: number;
    explainedVariance: number;
    loadings: Record<string, number>;
  }>;
  sampleScores: Array<{
    sampleNumber: number;
    sampleLabel: string;
    pc1: number;
    pc2: number;
  }>;
  consumerScores: Array<{
    respondentId: string;
    pc1: number;
    pc2: number;
  }>;
  rationale: string;
}

export interface SegmentationResult {
  k: number;
  segments: Array<{
    label: string;
    size: number;
    centroid: Record<string, number>;
    representativeRespondents: string[];
  }>;
  rationale: string;
}

export interface PreferenceMapResult {
  axes: { x: string; y: string };
  samples: Array<{
    sampleNumber: number;
    sampleLabel: string;
    x: number;
    y: number;
    meanLiking: number;
  }>;
  rationale: string;
}

export interface AdvancedAnalyticsResult {
  pca: PcaResult | null;
  segmentation: SegmentationResult | null;
  preferenceMap: PreferenceMapResult | null;
  warnings: string[];
}

export function runAdvancedAnalytics(
  rows: AttributeMatrixRow[],
  attributes: string[],
  options: { likingByRespondentSample: Map<string, number>; segments?: number } = { likingByRespondentSample: new Map() }
): AdvancedAnalyticsResult {
  const warnings: string[] = [];
  if (rows.length === 0 || attributes.length < 2) {
    return {
      pca: null,
      segmentation: null,
      preferenceMap: null,
      warnings: ["Advanced analytics require at least two attributes and one respondent."],
    };
  }

  // Build sample-attribute matrix (means per sample).
  const sampleGroups = new Map<number, { label: string; rows: AttributeMatrixRow[] }>();
  rows.forEach((row) => {
    const bucket = sampleGroups.get(row.sampleNumber) ?? { label: row.sampleLabel, rows: [] };
    bucket.label = bucket.label || row.sampleLabel;
    bucket.rows.push(row);
    sampleGroups.set(row.sampleNumber, bucket);
  });
  const sampleNumbers = Array.from(sampleGroups.keys()).sort((a, b) => a - b);
  const sampleMeansMatrix: number[][] = sampleNumbers.map((number) => {
    const group = sampleGroups.get(number)!;
    return attributes.map((attribute) => {
      const values = group.rows
        .map((row) => row.attributes[attribute])
        .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
      return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
    });
  });

  let pca: PcaResult | null = null;
  if (sampleMeansMatrix.length >= 2 && attributes.length >= 2) {
    const power = powerIterationPCA(sampleMeansMatrix, 2);
    const sampleScores = power.scores.map((row, index) => ({
      sampleNumber: sampleNumbers[index],
      sampleLabel: sampleGroups.get(sampleNumbers[index])!.label,
      pc1: round3(row[0]),
      pc2: round3(row[1]),
    }));

    // Consumer-level scores: project per-respondent attribute means.
    const consumerMatrix = new Map<string, number[]>();
    rows.forEach((row) => {
      if (!consumerMatrix.has(row.respondentId)) consumerMatrix.set(row.respondentId, attributes.map(() => 0));
      const accumulator = consumerMatrix.get(row.respondentId)!;
      attributes.forEach((attribute, index) => {
        const value = row.attributes[attribute];
        if (typeof value === "number" && Number.isFinite(value)) accumulator[index] = (accumulator[index] + value) / 2;
        else if (accumulator[index] === 0 && typeof value === "number") accumulator[index] = value;
      });
    });
    const consumerVectors = Array.from(consumerMatrix.entries()).map(([respondentId, vector]) => ({
      respondentId,
      vector,
    }));
    const consumerProjection = projectVectors(consumerVectors.map((entry) => entry.vector), power.eigenvectors, power.mean);
    const consumerScores = consumerProjection.map((projected, index) => ({
      respondentId: consumerVectors[index].respondentId,
      pc1: round3(projected[0]),
      pc2: round3(projected[1]),
    }));

    pca = {
      attributes,
      components: power.eigenvectors.map((vector, index) => ({
        component: index + 1,
        explainedVariance: round3(power.explainedVariance[index] ?? 0),
        loadings: Object.fromEntries(attributes.map((attribute, i) => [attribute, round3(vector[i])])),
      })),
      sampleScores,
      consumerScores,
      rationale: "PCA on per-sample attribute means highlights the directions that separate the products.",
    };
  } else {
    warnings.push("PCA skipped: not enough attributes or samples.");
  }

  // Segmentation: simple k-means on per-respondent attribute means with k=min(3, n/3).
  let segmentation: SegmentationResult | null = null;
  const respondents = Array.from(new Set(rows.map((row) => row.respondentId)));
  if (respondents.length >= 6) {
    const desiredK = options.segments ?? Math.min(3, Math.max(2, Math.floor(respondents.length / 5)));
    const matrix = respondents.map((respondentId) => {
      const respondentRows = rows.filter((row) => row.respondentId === respondentId);
      return attributes.map((attribute) => {
        const values = respondentRows
          .map((row) => row.attributes[attribute])
          .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
        return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
      });
    });
    const km = kMeans(matrix, desiredK);
    const segmentList: SegmentationResult["segments"] = [];
    for (let cluster = 0; cluster < desiredK; cluster += 1) {
      const memberIndices = km.assignments.flatMap((assignment, i) => (assignment === cluster ? [i] : []));
      if (memberIndices.length === 0) continue;
      const centroid = km.centroids[cluster];
      segmentList.push({
        label: `Segment ${cluster + 1}`,
        size: memberIndices.length,
        centroid: Object.fromEntries(attributes.map((attribute, i) => [attribute, round3(centroid[i])])),
        representativeRespondents: memberIndices.slice(0, 5).map((i) => respondents[i]),
      });
    }
    segmentation = {
      k: desiredK,
      segments: segmentList,
      rationale: `K-means clustering (k=${desiredK}) on per-respondent attribute means reveals consumer groups with similar liking profiles.`,
    };
  } else {
    warnings.push("Segmentation skipped: at least 6 respondents required.");
  }

  // Preference mapping: project samples on (PC1, PC2) of liking, weighted by liking values.
  let preferenceMap: PreferenceMapResult | null = null;
  if (pca && options.likingByRespondentSample.size > 0) {
    const samples = pca.sampleScores.map((score) => {
      const likings = rows
        .filter((row) => row.sampleNumber === score.sampleNumber)
        .map((row) => options.likingByRespondentSample.get(`${row.respondentId}::${row.sampleNumber}`))
        .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
      const meanLiking = likings.length > 0 ? likings.reduce((sum, value) => sum + value, 0) / likings.length : 0;
      return {
        sampleNumber: score.sampleNumber,
        sampleLabel: score.sampleLabel,
        x: score.pc1,
        y: score.pc2,
        meanLiking: round3(meanLiking),
      };
    });
    preferenceMap = {
      axes: { x: "Principal Component 1", y: "Principal Component 2" },
      samples,
      rationale: "Sample positions on the first two principal components, with mean liking encoded in the marker.",
    };
  } else if (!pca) {
    warnings.push("Preference map skipped: PCA could not be computed.");
  } else {
    warnings.push("Preference map skipped: per-sample liking scores were unavailable.");
  }

  return { pca, segmentation, preferenceMap, warnings };
}

function powerIterationPCA(
  data: number[][],
  k: number
): { eigenvectors: number[][]; explainedVariance: number[]; scores: number[][]; mean: number[] } {
  const rows = data.length;
  const cols = data[0]?.length ?? 0;
  if (rows === 0 || cols === 0) {
    return { eigenvectors: [], explainedVariance: [], scores: [], mean: [] };
  }
  const mean = Array.from({ length: cols }, (_, j) => data.reduce((sum, row) => sum + row[j], 0) / rows);
  const centered = data.map((row) => row.map((value, j) => value - mean[j]));

  // Covariance matrix (cols x cols).
  const cov: number[][] = Array.from({ length: cols }, () => Array(cols).fill(0));
  for (let i = 0; i < cols; i += 1) {
    for (let j = i; j < cols; j += 1) {
      let sum = 0;
      for (let r = 0; r < rows; r += 1) sum += centered[r][i] * centered[r][j];
      const value = sum / Math.max(1, rows - 1);
      cov[i][j] = value;
      cov[j][i] = value;
    }
  }

  const eigenvectors: number[][] = [];
  const eigenvalues: number[] = [];
  const workCov = cov.map((row) => [...row]);

  for (let component = 0; component < Math.min(k, cols); component += 1) {
    const eigen = powerIteration(workCov);
    eigenvectors.push(eigen.vector);
    eigenvalues.push(eigen.value);
    // Deflate
    for (let i = 0; i < cols; i += 1) {
      for (let j = 0; j < cols; j += 1) {
        workCov[i][j] -= eigen.value * eigen.vector[i] * eigen.vector[j];
      }
    }
  }

  const totalVariance = trace(cov) || 1;
  const explainedVariance = eigenvalues.map((value) => value / totalVariance);
  const scores = centered.map((row) => eigenvectors.map((eigenvector) => row.reduce((sum, value, j) => sum + value * eigenvector[j], 0)));

  return { eigenvectors, explainedVariance, scores, mean };
}

function powerIteration(matrix: number[][]) {
  const n = matrix.length;
  let vector = Array.from({ length: n }, () => 1 / Math.sqrt(n));
  let value = 0;
  for (let iter = 0; iter < 200; iter += 1) {
    const next = matrix.map((row) => row.reduce((sum, mij, j) => sum + mij * vector[j], 0));
    const norm = Math.sqrt(next.reduce((sum, v) => sum + v * v, 0)) || 1;
    const normalized = next.map((v) => v / norm);
    const newValue = normalized.reduce((sum, v, i) => sum + v * matrix[i].reduce((s, mij, j) => s + mij * normalized[j], 0), 0);
    if (Math.abs(newValue - value) < 1e-9) {
      value = newValue;
      vector = normalized;
      break;
    }
    value = newValue;
    vector = normalized;
  }
  return { vector, value };
}

function projectVectors(vectors: number[][], eigenvectors: number[][], mean: number[]) {
  return vectors.map((vector) => eigenvectors.map((eigenvector) => vector.reduce((sum, value, j) => sum + (value - mean[j]) * eigenvector[j], 0)));
}

function trace(matrix: number[][]) {
  return matrix.reduce((sum, row, i) => sum + (row[i] ?? 0), 0);
}

function kMeans(data: number[][], k: number, maxIter = 50): { centroids: number[][]; assignments: number[] } {
  if (data.length === 0) return { centroids: [], assignments: [] };
  const n = data.length;
  const dims = data[0].length;
  // Init: pick evenly spaced points.
  const centroids = Array.from({ length: k }, (_, i) => [...data[Math.floor((i * n) / k)]]);
  const assignments = Array(n).fill(0);

  for (let iter = 0; iter < maxIter; iter += 1) {
    let changed = false;
    for (let i = 0; i < n; i += 1) {
      let bestCluster = 0;
      let bestDistance = Infinity;
      for (let c = 0; c < k; c += 1) {
        const d = euclidean(data[i], centroids[c]);
        if (d < bestDistance) {
          bestDistance = d;
          bestCluster = c;
        }
      }
      if (assignments[i] !== bestCluster) {
        assignments[i] = bestCluster;
        changed = true;
      }
    }
    // Update centroids
    for (let c = 0; c < k; c += 1) {
      const members = data.filter((_, i) => assignments[i] === c);
      if (members.length === 0) continue;
      for (let j = 0; j < dims; j += 1) {
        centroids[c][j] = members.reduce((sum, row) => sum + row[j], 0) / members.length;
      }
    }
    if (!changed) break;
  }
  return { centroids, assignments };
}

function euclidean(a: number[], b: number[]) {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += (a[i] - b[i]) ** 2;
  return Math.sqrt(sum);
}

function round3(value: number) {
  return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : 0;
}
