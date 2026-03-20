import {
  ParseFoodDescriptionOutputSchema,
  type ParseFoodDescriptionOutput,
  type ParseFoodDescriptionSegment,
  type ResolvedFoodItems,
} from '@/lib/food-contract';
import {isCompositeFoodName} from '@/lib/food-text';
import {aggregateNutritionProfiles} from '@/lib/nutrition-profile';

function roundToTwoDecimals(value: number): number {
  return Number(value.toFixed(2));
}

export function sumResolvedFoodWeight(items: ResolvedFoodItems): number {
  return items.reduce((sum, item) => sum + item.estimatedGrams, 0);
}

export function calculateOverallConfidence(items: ResolvedFoodItems): number {
  const totalWeight = sumResolvedFoodWeight(items);
  if (!totalWeight) {
    return 0;
  }

  const weightedConfidence = items.reduce(
    (sum, item) => sum + item.confidence * item.estimatedGrams,
    0
  );
  return roundToTwoDecimals(weightedConfidence / totalWeight);
}

function aggregateTotals(items: ResolvedFoodItems) {
  return aggregateNutritionProfiles(
    items.map((item) => ({
      profile: item.totals,
      meta: item.totalsMeta,
    }))
  );
}

export function buildSegmentFromItems(
  sourceDescription: string,
  items: ResolvedFoodItems,
  resolutionKind: ParseFoodDescriptionSegment['resolutionKind'],
  ingredientBreakdown: ResolvedFoodItems = []
): ParseFoodDescriptionSegment {
  const totals = aggregateTotals(items);
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
    totalWeight: sumResolvedFoodWeight(items),
    overallConfidence: calculateOverallConfidence(items),
    items,
    ingredientBreakdown,
  };
}

function rebuildSegment(
  segment: ParseFoodDescriptionSegment,
  items: ResolvedFoodItems
): ParseFoodDescriptionSegment {
  const totals = aggregateTotals(items);

  return {
    ...segment,
    items,
    totalNutrition: totals.profile,
    totalNutritionMeta: totals.meta,
    totalWeight: sumResolvedFoodWeight(items),
    overallConfidence: calculateOverallConfidence(items),
  };
}

export function buildParseOutputFromSegments(
  segments: ParseFoodDescriptionSegment[],
  secondaryReviewSummary: ParseFoodDescriptionOutput['secondaryReviewSummary'] = null
): ParseFoodDescriptionOutput {
  const items = segments.flatMap((segment) => segment.items);
  const totals = aggregateTotals(items);

  return ParseFoodDescriptionOutputSchema.parse({
    compositeDishName: segments.length === 1 ? segments[0]?.compositeDishName ?? null : null,
    totalNutrition: totals.profile,
    totalNutritionMeta: totals.meta,
    totalWeight: sumResolvedFoodWeight(items),
    overallConfidence: calculateOverallConfidence(items),
    items,
    segments,
    secondaryReviewSummary,
  });
}

export function rebuildOutputFromItems(
  output: ParseFoodDescriptionOutput,
  items: ResolvedFoodItems
): ParseFoodDescriptionOutput {
  let offset = 0;

  const segments = output.segments.map((segment) => {
    const nextItems = items.slice(offset, offset + segment.items.length);
    offset += segment.items.length;
    return rebuildSegment(segment, nextItems);
  });
  const totals = aggregateTotals(items);

  return ParseFoodDescriptionOutputSchema.parse({
    ...output,
    totalNutrition: totals.profile,
    totalNutritionMeta: totals.meta,
    totalWeight: sumResolvedFoodWeight(items),
    overallConfidence: calculateOverallConfidence(items),
    items,
    segments,
    secondaryReviewSummary: output.secondaryReviewSummary ?? null,
  });
}

export function createSingleSegmentOutput(
  foods: ResolvedFoodItems,
  sourceDescription: string
): ParseFoodDescriptionOutput {
  const segment = buildSegmentFromItems(sourceDescription, foods, 'direct_items');

  return buildParseOutputFromSegments(
    [
      {
        ...segment,
        compositeDishName: null,
      },
    ],
    null
  );
}
