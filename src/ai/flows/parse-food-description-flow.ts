'use server';

import {
  ParseFoodDescriptionInputSchema,
  ParseFoodDescriptionOutputSchema,
  type AiParsedFoodItem,
  type ParseFoodDescriptionInput,
  type ParseFoodDescriptionOutput,
  type ParseFoodDescriptionSegment,
  type ResolvedFoodItems,
} from '@/lib/food-contract';
import {resolveCompositeDishFromRecipe, resolveCompositeDishWithAiIngredients} from '@/lib/composite-dish';
import {tryResolveDirectDescription} from '@/lib/direct-food-parser';
import {
  extractMultiFoodCandidates,
  extractSingleFoodCandidate,
  extractWholeDishCandidate,
  isCompositeFoodName,
  parseQuantity,
  sanitizeFoodName,
  splitFoodDescriptionSegments,
} from '@/lib/food-text';
import {parseFoodCandidatesWithPrimaryModel} from '@/lib/primary-model';
import {
  aggregateNutritionProfiles,
  createNutritionProfile,
  type NutritionFieldKey,
} from '@/lib/nutrition-profile';
import {estimateGrams} from '@/lib/portion-reference';
import {
  createNutritionLookupResolver,
  type NutritionLookupResolver,
  type NutritionLookupResult,
} from '@/lib/nutrition-db';
import {buildResolvedFood} from '@/lib/resolved-food';
import {recordFoodParseTelemetry, recordRuntimeError, type WeightResolutionTrace} from '@/lib/runtime-observability';
import {applySecondaryReviewToOutput} from '@/lib/secondary-review';
import {dedupeValidationFlags} from '@/lib/validation';

type WeightedResolution = {
  estimatedGrams: number;
  validationFlags: ResolvedFoodItems[number]['validationFlags'];
  trace: WeightResolutionTrace;
};

function sanitizeCandidate(candidate: AiParsedFoodItem): AiParsedFoodItem {
  return {
    ...candidate,
    foodName: sanitizeFoodName(candidate.foodName),
    quantityDescription: candidate.quantityDescription.trim() || '未知',
  };
}

async function chooseEstimatedGrams(
  candidate: AiParsedFoodItem,
  matchedName?: string | null
): Promise<WeightedResolution> {
  const estimated = await estimateGrams(
    candidate.foodName,
    candidate.quantityDescription,
    matchedName
  );
  const {unit} = parseQuantity(candidate.quantityDescription);
  const hasExplicitMetricUnit = Boolean(unit && ['g', '克', 'ml', '毫升'].includes(unit));
  const hasCandidateEstimate =
    Number.isFinite(candidate.estimatedGrams) && candidate.estimatedGrams > 0;
  const hasHighConfidenceCandidateEstimate = hasCandidateEstimate && candidate.confidence >= 0.75;
  const portionMatchStrategy = estimated.portion?.matchStrategy ?? 'fallback';
  const baseTrace = {
    foodName: candidate.foodName,
    quantityDescription: candidate.quantityDescription,
    portionMatchStrategy:
      estimated.portion?.matchStrategy ?? ('none' as const),
    aiEstimatedGrams: hasCandidateEstimate ? candidate.estimatedGrams : null,
    portionEstimatedGrams: estimated.grams,
    matchedName: matchedName ?? null,
  };

  if (hasExplicitMetricUnit) {
    return {
      estimatedGrams: estimated.grams,
      validationFlags: estimated.validationFlags,
      trace: {
        ...baseTrace,
        strategy: 'explicit_metric',
        finalEstimatedGrams: estimated.grams,
      },
    };
  }

  if (portionMatchStrategy === 'exact') {
    return {
      estimatedGrams: estimated.grams,
      validationFlags: estimated.validationFlags,
      trace: {
        ...baseTrace,
        strategy: 'portion_exact',
        finalEstimatedGrams: estimated.grams,
      },
    };
  }

  if (hasHighConfidenceCandidateEstimate && portionMatchStrategy === 'keyword') {
    const delta =
      Math.abs(candidate.estimatedGrams - estimated.grams) /
      Math.max(candidate.estimatedGrams, estimated.grams, 1);
    const estimatedPreferred =
      delta <= 0.3 || estimated.confidenceScore >= 0.85;
    const finalEstimatedGrams = estimatedPreferred
      ? estimated.grams
      : candidate.estimatedGrams;

    return {
      estimatedGrams: finalEstimatedGrams,
      validationFlags: estimated.validationFlags,
      trace: {
        ...baseTrace,
        strategy: estimatedPreferred
          ? 'portion_keyword_preferred'
          : 'portion_keyword_ai_preferred',
        finalEstimatedGrams,
      },
    };
  }

  if (hasHighConfidenceCandidateEstimate && portionMatchStrategy === 'fallback') {
    const delta =
      Math.abs(candidate.estimatedGrams - estimated.grams) /
      Math.max(candidate.estimatedGrams, estimated.grams, 1);
    const aiPreferred = delta <= 0.35 || candidate.confidence >= 0.9;
    const finalEstimatedGrams = aiPreferred
      ? candidate.estimatedGrams
      : estimated.grams;

    return {
      estimatedGrams: finalEstimatedGrams,
      validationFlags: estimated.validationFlags,
      trace: {
        ...baseTrace,
        strategy: aiPreferred
          ? 'portion_fallback_ai_preferred'
          : 'portion_fallback_preferred',
        finalEstimatedGrams,
      },
    };
  }

  return {
    estimatedGrams: estimated.grams,
    validationFlags: estimated.validationFlags,
    trace: {
      ...baseTrace,
      strategy: 'portion_default',
      finalEstimatedGrams: estimated.grams,
    },
  };
}

function extractSingleMetricWeight(description: string): number | null {
  const matches = [...description.matchAll(/(\d+(?:\.\d+)?)\s*(?:g|克|ml|毫升)/gi)];
  if (!matches.length) {
    return null;
  }

  const total = matches.reduce((sum, match) => {
    const value = Number.parseFloat(match[1] ?? '');
    return Number.isFinite(value) && value > 0 ? sum + value : sum;
  }, 0);
  return total > 0 ? total : null;
}

async function determineTargetTotalWeight(
  description: string,
  foods: ResolvedFoodItems
): Promise<number | null> {
  const explicitWeight = extractSingleMetricWeight(description);
  if (explicitWeight) {
    return explicitWeight;
  }

  if (foods.length < 2) {
    return null;
  }

  const candidate = extractSingleFoodCandidate(description) ?? extractWholeDishCandidate(description);
  if (!candidate?.foodName) {
    return null;
  }

  const estimated = await estimateGrams(
    candidate.foodName,
    candidate.quantityDescription,
    candidate.foodName
  );
  return estimated.grams > 0 ? estimated.grams : null;
}

function rebalanceResolvedFoods(
  foods: ResolvedFoodItems,
  totalWeight: number | null
): ResolvedFoodItems {
  if (!totalWeight || foods.length < 2) {
    return foods;
  }

  const currentTotalWeight = foods.reduce((sum, item) => sum + item.estimatedGrams, 0);
  if (!currentTotalWeight || Math.abs(currentTotalWeight - totalWeight) < 5) {
    return foods;
  }

  const preservedFoods = foods.filter((item) => item.sourceKind !== 'ai_fallback');
  const estimatedFoods = foods.filter((item) => item.sourceKind === 'ai_fallback');
  const adjustableFoods =
    preservedFoods.length > 0 && estimatedFoods.length > 0 ? estimatedFoods : foods;
  const lockedWeight =
    adjustableFoods === foods
      ? 0
      : preservedFoods.reduce((sum, item) => sum + item.estimatedGrams, 0);
  const adjustableWeight = adjustableFoods.reduce((sum, item) => sum + item.estimatedGrams, 0);
  const targetAdjustableWeight = totalWeight - lockedWeight;

  if (targetAdjustableWeight <= 0 || adjustableWeight <= 0) {
    return foods;
  }

  return foods.map((item) => {
    if (adjustableFoods !== foods && item.sourceKind !== 'ai_fallback') {
      return item;
    }

    const nextGrams = Math.max(
      1,
      Math.round((item.estimatedGrams / adjustableWeight) * targetAdjustableWeight)
    );
    return {
      ...item,
      estimatedGrams: nextGrams,
      validationFlags: dedupeValidationFlags([
        ...item.validationFlags,
        'composite_total_rebalanced',
      ]),
      totals: createNutritionProfile(
        Object.keys(item.totals).reduce((acc, key) => {
          const typedKey = key as NutritionFieldKey;
          acc[typedKey] =
            item.per100g[typedKey] === null
              ? null
              : Number(((item.per100g[typedKey] ?? 0) * nextGrams / 100).toFixed(1));
          return acc;
        }, {} as Partial<typeof item.totals>)
      ),
      totalsMeta: item.totalsMeta,
    };
  });
}

function calculateOverallConfidence(items: ResolvedFoodItems): number {
  const totalWeight = items.reduce((sum, item) => sum + item.estimatedGrams, 0);
  if (!totalWeight) {
    return 0;
  }

  const weightedConfidence = items.reduce(
    (sum, item) => sum + item.confidence * item.estimatedGrams,
    0
  );
  return Number((weightedConfidence / totalWeight).toFixed(2));
}

function buildSegmentFromItems(
  sourceDescription: string,
  items: ResolvedFoodItems,
  resolutionKind: ParseFoodDescriptionSegment['resolutionKind'],
  ingredientBreakdown: ResolvedFoodItems = []
): ParseFoodDescriptionSegment {
  const totals = aggregateNutritionProfiles(
    items.map((item) => ({
      profile: item.totals,
      meta: item.totalsMeta,
    }))
  );
  const compositeDishName =
    items.length === 1 && isCompositeFoodName(items[0]!.foodName)
      ? items[0]!.foodName
      : null;

  return {
    sourceDescription,
    compositeDishName,
    resolutionKind,
    totalNutrition: totals.profile,
    totalNutritionMeta: totals.meta,
    totalWeight: items.reduce((sum, item) => sum + item.estimatedGrams, 0),
    overallConfidence: calculateOverallConfidence(items),
    items,
    ingredientBreakdown,
  };
}

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

export async function resolveDescriptionSegment(
  description: string,
  lookupResolver: NutritionLookupResolver
): Promise<{segment: ParseFoodDescriptionSegment; traces: WeightResolutionTrace[]}> {
  try {
    const likelyMultiFood = Boolean(extractMultiFoodCandidates(description)?.length);
    const directlyResolvedFoods = await tryResolveDirectDescription(description, lookupResolver);
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

    if (likelyMultiFood) {
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

      return {
        segment: await resolveCompositeDishWithAiIngredients(
          wholeDishCandidate,
          lookupResolver
        ),
        traces: [],
      };
    }

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

export async function parseFoodDescription(
  input: ParseFoodDescriptionInput
): Promise<ParseFoodDescriptionOutput> {
  const parsedInput = ParseFoodDescriptionInputSchema.parse(input);
  const lookupResolver = createNutritionLookupResolver();
  const segments = splitFoodDescriptionSegments(parsedInput.description);
  const effectiveSegments = segments.length > 1 ? segments : [parsedInput.description];
  const segmentMemo = new Map<string, Promise<{segment: ParseFoodDescriptionSegment; traces: WeightResolutionTrace[]}>>();

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
  const items = resolvedSegments.flatMap((segment) => segment.items);
  const totals = aggregateNutritionProfiles(
    items.map((item) => ({
      profile: item.totals,
      meta: item.totalsMeta,
    }))
  );
  const initialOutput = ParseFoodDescriptionOutputSchema.parse({
    compositeDishName:
      resolvedSegments.length === 1 ? resolvedSegments[0]?.compositeDishName ?? null : null,
    totalNutrition: totals.profile,
    totalNutritionMeta: totals.meta,
    totalWeight: items.reduce((sum, item) => sum + item.estimatedGrams, 0),
    overallConfidence: calculateOverallConfidence(items),
    items,
    segments: resolvedSegments,
  });

  const reviewed = await applySecondaryReviewToOutput({
    sourceDescription: parsedInput.description,
    output: initialOutput,
    lockExplicitMetricWeights: true,
  });
  const output = ParseFoodDescriptionOutputSchema.parse(reviewed.output);

  await recordFoodParseTelemetry({
    description: parsedInput.description,
    output,
    weightResolutionTraces: segmentResults.flatMap((result) => result.traces),
    secondaryReview: reviewed.summary,
  });

  return output;
}
