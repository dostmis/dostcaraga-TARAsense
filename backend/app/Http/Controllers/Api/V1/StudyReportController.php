<?php

namespace App\Http\Controllers\Api\V1;

use App\Models\SensoryResponse;
use App\Models\Study;
use App\Models\User;
use App\Services\ApiResponseService;
use App\Services\Mobile\DateService;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;

class StudyReportController
{
    public function analysis(Request $request, string $studyId)
    {
        $study = Study::query()->with('analysis')->find($studyId);

        if (!$study) {
            return ApiResponseService::error('Study not found.', 404, 'STUDY_NOT_FOUND');
        }

        $accessError = $this->authorizeStudyAccess($request, $study);
        if ($accessError !== null) {
            return $accessError;
        }

        if (!$study->analysis) {
            return ApiResponseService::json($this->emptyAnalysisPayload());
        }

        $analysis = $study->analysis;
        $overallLiking = $this->normalizeOverallLiking($analysis->overallLiking);

        return ApiResponseService::json([
            'id' => $analysis->id,
            'studyId' => $analysis->studyId,
            'overallLiking' => $overallLiking,
            'attributeStats' => is_array($analysis->attributeStats) ? $analysis->attributeStats : [],
            'penaltyAnalysis' => is_array($analysis->penaltyAnalysis) ? $analysis->penaltyAnalysis : [],
            ...$this->extractExtendedAnalysisPayload($overallLiking),
            'aiInterpretation' => $analysis->aiInterpretation,
            'aiRecommendation' => $analysis->aiRecommendation,
            'decisionFlag' => $analysis->decisionFlag,
            'generatedAt' => DateService::iso($analysis->generatedAt),
            'updatedAt' => DateService::iso($analysis->updatedAt),
        ]);
    }

    public function compare(Request $request, string $studyId)
    {
        $study = Study::query()->find($studyId);

        if (!$study) {
            return ApiResponseService::error('Study not found.', 404, 'STUDY_NOT_FOUND');
        }

        $accessError = $this->authorizeStudyAccess($request, $study);
        if ($accessError !== null) {
            return $accessError;
        }

        $validated = $request->validate([
            'sampleNumbers' => ['required', 'array', 'min:1', 'max:50'],
            'sampleNumbers.*' => ['integer', 'min:1', 'max:100000'],
            'variableKey' => ['nullable', 'string', 'max:200', 'not_regex:/[\x00-\x1F\x7F]/'],
        ]);

        $sampleNumbers = collect($validated['sampleNumbers'])
            ->map(fn ($value) => (int) $value)
            ->unique()
            ->sort()
            ->values()
            ->all();
        $variableKey = $validated['variableKey'] ?? 'overallLiking';

        $responses = SensoryResponse::query()
            ->where('studyId', $studyId)
            ->get(['participantId', 'data']);

        $observations = $this->buildObservations($responses);
        $filtered = array_values(array_filter(
            $observations,
            fn (array $observation) => in_array($observation['sampleNumber'], $sampleNumbers, true)
        ));

        $inputs = array_map(function (int $sampleNumber) use ($filtered, $variableKey) {
            $sampleRows = array_values(array_filter(
                $filtered,
                fn (array $row) => $row['sampleNumber'] === $sampleNumber
            ));
            $sampleLabel = $sampleRows[0]['sampleLabel'] ?? "Sample {$sampleNumber}";
            $valuesByRespondent = [];

            foreach ($sampleRows as $row) {
                $value = $this->extractVariableValue($row, $variableKey);
                if (is_float($value) || is_int($value)) {
                    $valuesByRespondent[$row['respondentId']] = (float) $value;
                }
            }

            return [
                'sampleNumber' => $sampleNumber,
                'sampleLabel' => $sampleLabel,
                'valuesByRespondent' => $valuesByRespondent,
            ];
        }, $sampleNumbers);

        $studyDesign = $study->studyDesign === 'MONADIC' ? 'MONADIC' : 'WITHIN_SUBJECT';
        $result = $this->compareSamples($inputs, $studyDesign);

        return ApiResponseService::json([
            'variableKey' => $variableKey,
            'sampleSelection' => count($sampleNumbers) === count($observations) ? 'ALL_SAMPLES' : 'SUBSET',
            'sampleNumbers' => $sampleNumbers,
            'samples' => array_map(function (array $sample) {
                $values = array_values($sample['valuesByRespondent']);
                $mean = $this->mean($values);

                return [
                    'sampleNumber' => $sample['sampleNumber'],
                    'sampleLabel' => $sample['sampleLabel'],
                    'mean' => $this->round3($mean),
                    'stdDev' => $this->round3($this->stdDev($values, $mean)),
                    'n' => count($values),
                    'values' => $values,
                ];
            }, $inputs),
            'statisticalComparison' => [
                ...$result,
                'formattedPValue' => $this->formatPValue($result['pValue']),
            ],
        ]);
    }

    public function pdf()
    {
        return ApiResponseService::error(
            'PDF generation route is reserved for the Laravel report renderer. Install and wire a PDF engine before enabling it.',
            501,
            'PDF_ENGINE_NOT_CONFIGURED'
        );
    }

    private function emptyAnalysisPayload(): array
    {
        $overallLiking = $this->normalizeOverallLiking([]);

        return [
            'generatedAt' => DateService::iso(now()),
            'studyOverview' => null,
            'overallLiking' => $overallLiking,
            'attributeStats' => [],
            'penaltyAnalysis' => [],
            'perSampleResults' => [],
            'comparativeAnalysis' => null,
            'meanDropAnalysis' => [],
            'automaticInterpretation' => null,
            'aiInterpretation' => null,
            'aiRecommendation' => null,
            'decisionFlag' => null,
        ];
    }

    private function normalizeOverallLiking(mixed $overallLiking): array
    {
        $payload = is_array($overallLiking) ? $overallLiking : [];

        return array_merge([
            'mean' => 0,
            'stdDev' => 0,
            'n' => 0,
            'median' => 0,
            'samplePerformance' => [],
            'bySample' => [],
            'bestSample' => null,
            'perSampleResults' => [],
            'comparativeAnalysis' => null,
            'meanDropAnalysis' => [],
            'automaticInterpretation' => null,
            'dataQuality' => null,
            'advancedAnalytics' => null,
        ], $payload);
    }

    private function extractExtendedAnalysisPayload(array $overallLiking): array
    {
        $perSampleResults = $overallLiking['perSampleResults'] ?? null;
        if (!is_array($perSampleResults)) {
            $perSampleResults = is_array($overallLiking['bySample'] ?? null)
                ? $overallLiking['bySample']
                : [];
        }

        return [
            'studyOverview' => $overallLiking['studyOverview'] ?? null,
            'perSampleResults' => $perSampleResults,
            'comparativeAnalysis' => $overallLiking['comparativeAnalysis'] ?? null,
            'meanDropAnalysis' => is_array($overallLiking['meanDropAnalysis'] ?? null)
                ? $overallLiking['meanDropAnalysis']
                : [],
            'automaticInterpretation' => $overallLiking['automaticInterpretation'] ?? null,
            'dataQuality' => $overallLiking['dataQuality'] ?? null,
            'advancedAnalytics' => $overallLiking['advancedAnalytics'] ?? null,
        ];
    }

    private function authorizeStudyAccess(Request $request, Study $study): ?JsonResponse
    {
        $role = (string) $request->input('authRole', '');
        $userId = (string) $request->input('authUserId', '');

        if ($role === 'CONSUMER' || $userId === '') {
            return ApiResponseService::error('Unauthorized.', 401, 'UNAUTHORIZED');
        }

        if ($role === 'ADMIN') {
            return null;
        }

        if ($role === 'MSME' && $userId === $study->creatorId) {
            return null;
        }

        if ($role === 'FIC') {
            $user = User::query()->select(['assignedFacility'])->find($userId);
            $assignedFacility = trim((string) ($user?->assignedFacility ?? ''));
            $studyLocation = trim((string) $study->location);

            if ($assignedFacility !== '' && strcasecmp($assignedFacility, $studyLocation) === 0) {
                return null;
            }
        }

        return ApiResponseService::error('Forbidden.', 403, 'FORBIDDEN');
    }

    private function buildObservations(iterable $responses): array
    {
        $out = [];

        foreach ($responses as $response) {
            $data = is_array($response->data) ? $response->data : [];
            $samples = isset($data['sampleResponses']) && is_array($data['sampleResponses']) && count($data['sampleResponses']) > 0
                ? $data['sampleResponses']
                : [[
                    'sampleNumber' => 1,
                    'sampleLabel' => 'Sample 1',
                    'overallLiking' => $data['overallLiking'] ?? null,
                    'attributes' => is_array($data['attributes'] ?? null) ? $data['attributes'] : [],
                ]];

            foreach ($samples as $sample) {
                if (!is_array($sample)) {
                    continue;
                }

                $sampleNumber = isset($sample['sampleNumber']) && is_numeric($sample['sampleNumber']) && (int) $sample['sampleNumber'] > 0
                    ? (int) $sample['sampleNumber']
                    : 1;
                $sampleLabel = trim((string) ($sample['sampleLabel'] ?? ''));

                $out[] = [
                    'respondentId' => (string) $response->participantId,
                    'sampleNumber' => $sampleNumber,
                    'sampleLabel' => $sampleLabel !== '' ? $sampleLabel : "Sample {$sampleNumber}",
                    'overallLiking' => is_numeric($sample['overallLiking'] ?? null)
                        ? (float) $sample['overallLiking']
                        : (is_numeric($data['overallLiking'] ?? null) ? (float) $data['overallLiking'] : null),
                    'attributes' => is_array($sample['attributes'] ?? null) ? $sample['attributes'] : [],
                ];
            }
        }

        return $out;
    }

    private function extractVariableValue(array $observation, string $variableKey): ?float
    {
        if ($variableKey === 'overallLiking') {
            return is_numeric($observation['overallLiking']) ? (float) $observation['overallLiking'] : null;
        }

        $attributes = is_array($observation['attributes']) ? $observation['attributes'] : [];

        if (str_starts_with($variableKey, '__penalty__::') || str_starts_with($variableKey, '__meanDrop__::')) {
            $attributeName = explode('::', $variableKey, 2)[1] ?? '';
            $value = $attributes[$attributeName] ?? null;
            $liking = $observation['overallLiking'];

            if (!is_numeric($liking) || !is_numeric($value)) {
                return null;
            }

            $jarScore = (int) $value;
            if ($jarScore >= 1 && $jarScore <= 5 && $jarScore !== 3) {
                return (float) $liking;
            }

            return null;
        }

        $value = $attributes[$variableKey] ?? null;
        if (is_numeric($value)) {
            return (float) $value;
        }

        return is_numeric($observation['overallLiking']) ? (float) $observation['overallLiking'] : null;
    }

    private function compareSamples(array $samples, string $studyDesign): array
    {
        $validSamples = array_values(array_filter(
            $samples,
            fn (array $sample) => count($sample['valuesByRespondent']) > 0
        ));
        $repeatedMeasures = $studyDesign === 'WITHIN_SUBJECT' && $this->hasRepeatedMeasures($validSamples);
        $warnings = [];

        if ($studyDesign === 'WITHIN_SUBJECT' && !$repeatedMeasures) {
            $warnings[] = 'Study is configured as within-subject but respondent overlap is incomplete; treating samples as independent.';
        }

        if (count($validSamples) < 2) {
            return $this->comparisonResult(
                'DESCRIPTIVE_ONLY',
                'Descriptive only',
                $studyDesign,
                false,
                null,
                null,
                null,
                'Only descriptive statistics are available because fewer than two samples have valid scores.',
                ['At least two samples with valid responses are required for statistical comparison.']
            );
        }

        if (count($validSamples) === 2) {
            return $this->compareTwoSamples($validSamples[0], $validSamples[1], $studyDesign, $repeatedMeasures, $warnings);
        }

        return $this->compareManySamples($validSamples, $studyDesign, $repeatedMeasures, $warnings);
    }

    private function compareTwoSamples(array $left, array $right, string $studyDesign, bool $repeatedMeasures, array $warnings): array
    {
        if ($repeatedMeasures) {
            $pairs = [];
            foreach ($left['valuesByRespondent'] as $respondentId => $leftValue) {
                if (array_key_exists($respondentId, $right['valuesByRespondent'])) {
                    $pairs[] = $leftValue - $right['valuesByRespondent'][$respondentId];
                }
            }

            if (count($pairs) < 5) {
                return $this->comparisonResult(
                    'DESCRIPTIVE_ONLY',
                    'Descriptive only',
                    $studyDesign,
                    true,
                    null,
                    null,
                    null,
                    'Not enough paired observations are available for a stable two-sample comparison.',
                    array_merge($warnings, ['At least five complete respondent pairs are required for paired comparison.'])
                );
            }

            $meanDiff = $this->mean($pairs);
            $stdDiff = $this->stdDev($pairs, $meanDiff);
            $statistic = $stdDiff > 0 ? $meanDiff / ($stdDiff / sqrt(count($pairs))) : 0.0;
            $pValue = $this->twoTailedNormalPValue($statistic);

            return $this->comparisonResult(
                'PAIRED_T_TEST',
                'Paired t-test',
                $studyDesign,
                true,
                $pValue,
                $statistic,
                $pValue < 0.05,
                $this->describeSignificance($pValue, 'paired mean liking'),
                $warnings
            );
        }

        $leftValues = array_values($left['valuesByRespondent']);
        $rightValues = array_values($right['valuesByRespondent']);

        if (count($leftValues) < 5 || count($rightValues) < 5) {
            return $this->comparisonResult(
                'DESCRIPTIVE_ONLY',
                'Descriptive only',
                $studyDesign,
                false,
                null,
                null,
                null,
                'Not enough observations are available for a stable independent-sample comparison.',
                array_merge($warnings, ['Each sample needs at least five valid responses for independent comparison.'])
            );
        }

        $leftMean = $this->mean($leftValues);
        $rightMean = $this->mean($rightValues);
        $leftVar = $this->variance($leftValues, $leftMean);
        $rightVar = $this->variance($rightValues, $rightMean);
        $standardError = sqrt(($leftVar / count($leftValues)) + ($rightVar / count($rightValues)));
        $statistic = $standardError > 0 ? ($leftMean - $rightMean) / $standardError : 0.0;
        $pValue = $this->twoTailedNormalPValue($statistic);

        return $this->comparisonResult(
            'WELCH_T_TEST',
            'Welch t-test',
            $studyDesign,
            false,
            $pValue,
            $statistic,
            $pValue < 0.05,
            $this->describeSignificance($pValue, 'independent sample means'),
            $warnings
        );
    }

    private function compareManySamples(array $samples, string $studyDesign, bool $repeatedMeasures, array $warnings): array
    {
        $groups = array_map(fn (array $sample) => array_values($sample['valuesByRespondent']), $samples);
        $flat = array_merge(...$groups);

        if (count($flat) < count($groups) * 2) {
            return $this->comparisonResult(
                'DESCRIPTIVE_ONLY',
                'Descriptive only',
                $studyDesign,
                $repeatedMeasures,
                null,
                null,
                null,
                'Not enough observations are available for a stable multi-sample comparison.',
                array_merge($warnings, ['Each selected sample should have valid responses before running comparison.'])
            );
        }

        $grandMean = $this->mean($flat);
        $between = 0.0;
        $within = 0.0;

        foreach ($groups as $group) {
            $groupMean = $this->mean($group);
            $between += count($group) * (($groupMean - $grandMean) ** 2);
            foreach ($group as $value) {
                $within += ($value - $groupMean) ** 2;
            }
        }

        $dfBetween = count($groups) - 1;
        $dfWithin = count($flat) - count($groups);
        $statistic = $dfBetween > 0 && $dfWithin > 0 && $within > 0
            ? ($between / $dfBetween) / ($within / $dfWithin)
            : null;

        return $this->comparisonResult(
            $repeatedMeasures ? 'REPEATED_MEASURES_ANOVA' : 'ONE_WAY_ANOVA',
            $repeatedMeasures ? 'Repeated-measures ANOVA' : 'One-way ANOVA',
            $studyDesign,
            $repeatedMeasures,
            null,
            $statistic,
            null,
            'Multi-sample comparison was calculated with descriptive group statistics. Exact p-value calculation is not enabled in the Laravel statistics adapter yet.',
            array_merge($warnings, ['Exact multi-sample p-values require the full statistical engine port.'])
        );
    }

    private function comparisonResult(
        string $test,
        string $testLabel,
        string $studyDesign,
        bool $repeatedMeasures,
        ?float $pValue,
        ?float $statistic,
        ?bool $significant,
        string $interpretation,
        array $warnings = []
    ): array {
        return [
            'test' => $test,
            'testLabel' => $testLabel,
            'studyDesign' => $studyDesign,
            'repeatedMeasures' => $repeatedMeasures,
            'pValue' => $pValue !== null ? $this->round3($pValue) : null,
            'statistic' => $statistic !== null ? $this->round3($statistic) : null,
            'significant' => $significant,
            'alpha' => 0.05,
            'interpretation' => $interpretation,
            'assumptionChecks' => [
                'normality' => ['name' => 'NORMALITY', 'label' => 'Normality', 'passed' => null, 'pValue' => null, 'detail' => 'Not evaluated in Laravel adapter.'],
                'homogeneity' => ['name' => 'HOMOGENEITY', 'label' => 'Homogeneity of variance', 'passed' => null, 'pValue' => null, 'detail' => 'Not evaluated in Laravel adapter.'],
                'sampleSizeAdequacy' => ['name' => 'SAMPLE_SIZE', 'label' => 'Sample size adequacy', 'passed' => null, 'pValue' => null, 'detail' => 'Checked using minimum response thresholds.'],
                'recommendedPathway' => 'PARAMETRIC',
                'rationale' => 'Laravel adapter uses validated numeric response data and conservative descriptive fallbacks.',
            ],
            'effectSize' => null,
            'postHocResults' => [],
            'assumptions' => [],
            'warnings' => $warnings,
        ];
    }

    private function hasRepeatedMeasures(array $samples): bool
    {
        if (count($samples) < 2) {
            return false;
        }

        $respondents = array_keys($samples[0]['valuesByRespondent']);
        if (count($respondents) === 0) {
            return false;
        }

        foreach (array_slice($samples, 1) as $sample) {
            foreach ($respondents as $respondentId) {
                if (!array_key_exists($respondentId, $sample['valuesByRespondent'])) {
                    return false;
                }
            }
        }

        return true;
    }

    private function mean(array $values): float
    {
        return count($values) > 0 ? array_sum($values) / count($values) : 0.0;
    }

    private function variance(array $values, ?float $mean = null): float
    {
        if (count($values) < 2) {
            return 0.0;
        }

        $mean ??= $this->mean($values);
        return array_sum(array_map(fn (float $value) => ($value - $mean) ** 2, $values)) / (count($values) - 1);
    }

    private function stdDev(array $values, ?float $mean = null): float
    {
        return sqrt($this->variance($values, $mean));
    }

    private function twoTailedNormalPValue(float $z): float
    {
        return max(0.0, min(1.0, 2 * (1 - $this->normalCdf(abs($z)))));
    }

    private function normalCdf(float $x): float
    {
        return 0.5 * (1 + $this->erf($x / sqrt(2)));
    }

    private function erf(float $x): float
    {
        $sign = $x < 0 ? -1 : 1;
        $x = abs($x);
        $a1 = 0.254829592;
        $a2 = -0.284496736;
        $a3 = 1.421413741;
        $a4 = -1.453152027;
        $a5 = 1.061405429;
        $p = 0.3275911;
        $t = 1 / (1 + $p * $x);
        $y = 1 - (((((($a5 * $t + $a4) * $t) + $a3) * $t + $a2) * $t + $a1) * $t) * exp(-$x * $x);

        return $sign * $y;
    }

    private function formatPValue(?float $value): string
    {
        if ($value === null || !is_finite($value)) {
            return 'N/A';
        }

        return $value < 0.001 ? '< 0.001' : number_format($value, 3);
    }

    private function describeSignificance(?float $pValue, string $subject): string
    {
        if ($pValue === null) {
            return "No statistical inference was calculated for {$subject}.";
        }

        return $pValue < 0.05
            ? "There is a statistically significant difference in {$subject} (p < 0.05)."
            : "No statistically significant difference was detected in {$subject} (p >= 0.05).";
    }

    private function round3(float $value): float
    {
        return is_finite($value) ? round($value, 3) : 0.0;
    }
}
