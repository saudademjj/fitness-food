'use server';

import {
  ParseFoodDescriptionInputSchema,
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
  splitFoodDescriptionSegments,
} from '@/lib/food-text';
import {parseFoodCandidatesWithPrimaryModel} from '@/lib/primary-model';
import {createNutritionProfile} from '@/lib/nutrition-profile';
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
  const initialOutput = buildParseOutputFromSegments(resolvedSegments, null);

  await recordFoodParseTelemetry({
    description: parsedInput.description,
    output: initialOutput,
    weightResolutionTraces: segmentResults.flatMap((result) => result.traces),
  });

  return initialOutput;
}
