'use server';

import {
  ParseFoodDescriptionInputSchema,
  type ParseFoodDescriptionInput,
  type ParseFoodDescriptionOutput,
  type ParseFoodDescriptionSegment,
  type ResolvedFoodItems,
  type CrossValidationSummaryOutput,
} from '@/lib/food-contract';
import {resolveCompositeDishFromRecipe, resolveCompositeDishWithAiIngredients} from '@/lib/composite-dish';
import {crossValidate, type CrossValidationSummary} from '@/lib/cross-validation';
import {tryResolveDirectDescription} from '@/lib/direct-food-parser';
import {
  extractMultiFoodCandidates,
  extractSingleFoodCandidate,
  extractWholeDishCandidate,
  isCompositeFoodName,
  splitFoodDescriptionSegments,
} from '@/lib/food-text';
import {parseFoodCandidatesWithPrimaryModel} from '@/lib/primary-model';
import {parallelAiEstimate} from '@/lib/parallel-ai-estimator';
import {buildNutritionProfileMeta, createNutritionProfile, scaleNutritionProfile, cloneNutritionProfileMeta} from '@/lib/nutrition-profile';
import {
  createNutritionLookupResolver,
  type NutritionLookupResolver,
  type NutritionLookupResult,
} from '@/lib/nutrition-db';
import {
  buildParseOutputFromSegments,
  buildSegmentFromItems,
} from '@/lib/food-parse-output';
import {
  chooseEstimatedGrams,
  determineTargetTotalWeight,
  rebalanceResolvedFoods,
  sanitizeCandidate,
} from '@/lib/parse-weight-resolution';
import {estimateGrams} from '@/lib/portion-reference';
import {buildResolvedFood} from '@/lib/resolved-food';
import {recordFoodParseTelemetry, recordRuntimeError, type WeightResolutionTrace} from '@/lib/runtime-observability';
import {dedupeValidationFlags} from '@/lib/validation';

async function buildWholeDishDbSegment(
  candidate: {foodName: string; quantityDescription: string},
  wholeDishMatch: NutritionLookupResult
): Promise<ParseFoodDescriptionSegment> {
  const estimated = await estimateGrams(
    candidate.foodName,
    candidate.quantityDescription,
    wholeDishMatch.matchedName
  );
  const item = buildResolvedFood({
    foodName: wholeDishMatch.matchedName,
    quantityDescription: candidate.quantityDescription,
    estimatedGrams: estimated.grams,
    confidence: wholeDishMatch.matchMode === 'exact' ? 0.94 : 0.84,
    dbMatch: wholeDishMatch,
    fallbackPer100g: createNutritionProfile(),
    validationFlags: dedupeValidationFlags([
      ...estimated.validationFlags,
      ...(isCompositeFoodName(candidate.foodName) ? (['whole_dish_db_override'] as const) : []),
    ]),
  });

  return buildSegmentFromItems(
    candidate.quantityDescription === '未知'
      ? candidate.foodName
      : `${candidate.quantityDescription}${candidate.foodName}`,
    [item],
    'whole_dish_db'
  );
}

async function resolveAiCandidates(
  description: string,
  lookupResolver: NutritionLookupResolver
): Promise<{
  items: ResolvedFoodItems;
  traces: WeightResolutionTrace[];
  ingredientBreakdown: ResolvedFoodItems;
}> {
  const candidates = await parseFoodCandidatesWithPrimaryModel(description);
  const resolved = await Promise.all(
    candidates.map(async (candidate) => {
      const normalizedCandidate = sanitizeCandidate(candidate);
      const dbMatch = await lookupResolver(normalizedCandidate.foodName, {
        allowFuzzy: !isCompositeFoodName(normalizedCandidate.foodName),
        recordMiss: true,
      });

      if (!dbMatch && isCompositeFoodName(normalizedCandidate.foodName)) {
        const compositeSegment = await resolveCompositeDishWithAiIngredients(
          {
            foodName: normalizedCandidate.foodName,
            quantityDescription: normalizedCandidate.quantityDescription,
          },
          lookupResolver
        );

        return {
          item: compositeSegment.items[0]!,
          trace: null,
          ingredientBreakdown: compositeSegment.ingredientBreakdown,
        };
      }

      const estimated = await chooseEstimatedGrams(normalizedCandidate, dbMatch?.matchedName);
      const item = buildResolvedFood({
        foodName: normalizedCandidate.foodName,
        quantityDescription: normalizedCandidate.quantityDescription,
        estimatedGrams: estimated.estimatedGrams,
        confidence: normalizedCandidate.confidence,
        dbMatch,
        fallbackPer100g: normalizedCandidate.fallbackPer100g,
        fallbackPer100gMeta: normalizedCandidate.fallbackPer100gMeta,
        validationFlags: estimated.validationFlags,
        fallbackValidationFlags: dedupeValidationFlags([
          'ai_macro_estimate',
          'db_lookup_miss',
          ...(normalizedCandidate.fallbackAdjusted ? (['ai_macro_clamped'] as const) : []),
          ...(normalizedCandidate.fallbackValidationIssues.length
            ? (['ai_macro_unverified'] as const)
            : []),
        ]),
        fallbackSourceLabel: normalizedCandidate.fallbackAdjusted
          ? 'AI 保守修正宏量估算'
          : 'AI 宏量估算',
        fallbackConfidenceCap:
          normalizedCandidate.fallbackAdjusted ||
          normalizedCandidate.fallbackValidationIssues.length
            ? 0.45
            : 0.62,
      });

      return {
        item,
        trace: estimated.trace,
        ingredientBreakdown: [] as ResolvedFoodItems,
      };
    })
  );

  const items = resolved.map((entry) => entry.item);
  const ingredientBreakdown = resolved.flatMap((entry) => entry.ingredientBreakdown);
  const targetTotalWeight =
    ingredientBreakdown.length > 0
      ? null
      : await determineTargetTotalWeight(description, items);
  const rebalancedItems =
    ingredientBreakdown.length > 0
      ? items
      : rebalanceResolvedFoods(items, targetTotalWeight);

  return {
    items: rebalancedItems,
    traces: resolved
      .map((entry) => entry.trace)
      .filter((trace): trace is WeightResolutionTrace => Boolean(trace)),
    ingredientBreakdown,
  };
}

async function resolveParallelAiCandidates(
  description: string,
  lookupResolver: NutritionLookupResolver
): Promise<{
  items: ResolvedFoodItems;
  crossValidationSummary: CrossValidationSummary;
}> {
  const estimation = await parallelAiEstimate(description);
  const validation = crossValidate(
    estimation.results,
    estimation.failures,
    estimation.totalProviders
  );

  if (validation.items.length === 0) {
    throw new Error('All AI estimators failed to return results.');
  }

  const isDegraded = validation.consensusLevel === 'degraded';
  const isHighConsensus = validation.consensusLevel === 'high';

  const resolved = await Promise.all(
    validation.items.map(async (cvItem) => {
      const dbMatch = await lookupResolver(cvItem.foodName, {
        allowFuzzy: !isCompositeFoodName(cvItem.foodName),
        recordMiss: true,
      });

      const crossValidationFlags = dedupeValidationFlags([
        'ai_macro_estimate',
        ...(isDegraded ? (['ai_cross_validation_degraded'] as const) : (['ai_cross_validated'] as const)),
        ...(isHighConsensus ? (['ai_consensus_high'] as const) : []),
        ...(!isHighConsensus && !isDegraded && validation.consensusLevel === 'low' ? (['ai_consensus_low'] as const) : []),
        ...((!dbMatch) ? (['db_lookup_miss'] as const) : []),
      ]);

      if (dbMatch) {
        // DB match found: use DB nutrition for measured fields, keep AI consensus for gaps
        const item = buildResolvedFood({
          foodName: cvItem.foodName,
          quantityDescription: cvItem.quantityDescription,
          estimatedGrams: cvItem.estimatedGrams,
          confidence: Math.max(cvItem.confidence, dbMatch.matchMode === 'exact' ? 0.9 : 0.8),
          dbMatch,
          fallbackPer100g: cvItem.fallbackPer100g,
          fallbackPer100gMeta: buildNutritionProfileMeta(cvItem.fallbackPer100g, {
            knownStatus: 'estimated',
            knownSource: 'ai',
            missingSource: 'ai',
          }),
          validationFlags: crossValidationFlags,
          fallbackValidationFlags: crossValidationFlags,
          fallbackSourceLabel: isDegraded ? 'AI 交叉验证(降级)' : 'AI 三模型交叉验证',
          fallbackConfidenceCap: isDegraded ? 0.5 : 0.75,
        });
        return item;
      }

      // No DB match: use AI consensus directly
      const fallbackMeta = buildNutritionProfileMeta(cvItem.fallbackPer100g, {
        knownStatus: 'estimated',
        knownSource: 'ai',
        missingSource: 'ai',
      });

      const item = buildResolvedFood({
        foodName: cvItem.foodName,
        quantityDescription: cvItem.quantityDescription,
        estimatedGrams: cvItem.estimatedGrams,
        confidence: cvItem.confidence,
        dbMatch: null,
        fallbackPer100g: cvItem.fallbackPer100g,
        fallbackPer100gMeta: fallbackMeta,
        validationFlags: crossValidationFlags,
        fallbackValidationFlags: crossValidationFlags,
        fallbackSourceLabel: isDegraded ? 'AI 交叉验证(降级)' : 'AI 三模型交叉验证',
        fallbackConfidenceCap: isDegraded ? 0.5 : 0.75,
      });
      return item;
    })
  );

  return {
    items: resolved,
    crossValidationSummary: validation,
  };
}

export async function resolveDescriptionSegment(
  description: string,
  lookupResolver: NutritionLookupResolver
): Promise<{
  segment: ParseFoodDescriptionSegment;
  traces: WeightResolutionTrace[];
  crossValidationSummary?: CrossValidationSummary;
}> {
  try {
    const likelyMultiFood = Boolean(extractMultiFoodCandidates(description)?.length);
    const directlyResolvedFoods = await tryResolveDirectDescription(description, lookupResolver);

    // Tier 1: DB direct hit with high confidence
    if (directlyResolvedFoods?.length) {
      const directCandidate =
        extractWholeDishCandidate(description) ?? extractSingleFoodCandidate(description);

      if (
        directlyResolvedFoods.length === 1 &&
        directlyResolvedFoods[0]?.sourceKind === 'recipe' &&
        directCandidate?.foodName
      ) {
        const exactRecipeMatch = await lookupResolver(directCandidate.foodName, {
          allowFuzzy: false,
        });
        if (exactRecipeMatch?.sourceKind === 'recipe') {
          const recipeSegment = await resolveCompositeDishFromRecipe(
            directCandidate,
            exactRecipeMatch,
            lookupResolver
          );
          if (recipeSegment) {
            return {
              segment: recipeSegment,
              traces: [],
            };
          }
        }
      }

      // Check if all direct results are high-confidence DB hits
      const allHighConfidence = directlyResolvedFoods.every(
        (item) => item.confidence >= 0.9 && item.sourceKind !== 'ai_fallback'
      );

      if (allHighConfidence) {
        return {
          segment: buildSegmentFromItems(
            description,
            directlyResolvedFoods,
            directlyResolvedFoods.length === 1 && isCompositeFoodName(directlyResolvedFoods[0]!.foodName)
              ? 'whole_dish_db'
              : 'direct_items'
          ),
          traces: [],
        };
      }

      // Non-high-confidence direct results: still return them (DB is still primary)
      return {
        segment: buildSegmentFromItems(
          description,
          directlyResolvedFoods,
          directlyResolvedFoods.length === 1 && isCompositeFoodName(directlyResolvedFoods[0]!.foodName)
            ? 'whole_dish_db'
            : 'direct_items'
        ),
        traces: [],
      };
    }

    // Whole dish candidates that hit DB exactly
    if (!likelyMultiFood) {
      const wholeDishCandidate = extractWholeDishCandidate(description);
      if (wholeDishCandidate?.foodName) {
        const exactWholeDishMatch = await lookupResolver(wholeDishCandidate.foodName, {
          allowFuzzy: false,
        });

        if (exactWholeDishMatch?.sourceKind === 'recipe') {
          const recipeSegment = await resolveCompositeDishFromRecipe(
            wholeDishCandidate,
            exactWholeDishMatch,
            lookupResolver
          );
          if (recipeSegment) {
            return {
              segment: recipeSegment,
              traces: [],
            };
          }
        }

        if (exactWholeDishMatch?.matchMode === 'exact') {
          return {
            segment: await buildWholeDishDbSegment(wholeDishCandidate, exactWholeDishMatch),
            traces: [],
          };
        }
      }
    }

    // Tier 3: DB miss or complex input → 3AI parallel estimation
    try {
      const parallelResult = await resolveParallelAiCandidates(description, lookupResolver);
      return {
        segment: buildSegmentFromItems(
          description,
          parallelResult.items,
          'ai_cross_validated'
        ),
        traces: [],
        crossValidationSummary: parallelResult.crossValidationSummary,
      };
    } catch (parallelError) {
      // If parallel estimation fails completely, fall back to single-model AI
      await recordRuntimeError({
        scope: 'parse_food_description.segment',
        code: 'parallel_ai_fallback',
        message: parallelError instanceof Error ? parallelError.message : String(parallelError),
        context: {description},
      });

      const aiResolved = await resolveAiCandidates(description, lookupResolver);
      return {
        segment: buildSegmentFromItems(
          description,
          aiResolved.items,
          'ai_items',
          aiResolved.ingredientBreakdown
        ),
        traces: aiResolved.traces,
      };
    }
  } catch (error) {
    await recordRuntimeError({
      scope: 'parse_food_description.segment',
      code: 'segment_resolution_failed',
      message: error instanceof Error ? error.message : String(error),
      context: {description},
    });
    throw error;
  }
}

function toCrossValidationSummaryOutput(
  summary: CrossValidationSummary
): CrossValidationSummaryOutput {
  return {
    totalProviders: summary.totalProviders,
    successfulProviders: summary.successfulProviders,
    failedProviders: summary.failedProviders,
    averageScore: summary.averageScore,
    consensusLevel: summary.consensusLevel,
  };
}

export async function parseFoodDescription(
  input: ParseFoodDescriptionInput
): Promise<ParseFoodDescriptionOutput> {
  const parsedInput = ParseFoodDescriptionInputSchema.parse(input);
  const lookupResolver = createNutritionLookupResolver();
  const segments = splitFoodDescriptionSegments(parsedInput.description);
  const effectiveSegments = segments.length > 1 ? segments : [parsedInput.description];
  const segmentMemo = new Map<string, Promise<{
    segment: ParseFoodDescriptionSegment;
    traces: WeightResolutionTrace[];
    crossValidationSummary?: CrossValidationSummary;
  }>>();

  const segmentResults = await Promise.all(
    effectiveSegments.map(async (segment) => {
      const key = segment.trim().toLowerCase();
      if (!segmentMemo.has(key)) {
        segmentMemo.set(key, resolveDescriptionSegment(segment, lookupResolver));
      }
      return segmentMemo.get(key)!;
    })
  );

  const resolvedSegments = segmentResults.map((result) => result.segment);

  // Collect cross-validation summaries from all segments
  const crossValidationSummaries = segmentResults
    .map((result) => result.crossValidationSummary)
    .filter((s): s is CrossValidationSummary => Boolean(s));
  const primaryCrossValidation = crossValidationSummaries.length > 0
    ? crossValidationSummaries[0]
    : null;

  const initialOutput = buildParseOutputFromSegments(resolvedSegments, null);

  // Attach cross-validation summary if available
  const outputWithCrossValidation: ParseFoodDescriptionOutput = primaryCrossValidation
    ? {
        ...initialOutput,
        crossValidationSummary: toCrossValidationSummaryOutput(primaryCrossValidation),
      }
    : initialOutput;

  await recordFoodParseTelemetry({
    description: parsedInput.description,
    output: outputWithCrossValidation,
    weightResolutionTraces: segmentResults.flatMap((result) => result.traces),
  });

  return outputWithCrossValidation;
}
