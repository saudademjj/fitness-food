import type {AiParsedFoodItem, NutritionProfile23} from '@/lib/food-contract';
import {normalizeLookupText, sanitizeFoodName} from '@/lib/food-text';
import {
  average,
  buildConsensusProfileFromParsed,
  calculateNutritionAgreement,
  calculateWeightAgreement,
  clamp01,
  median,
  roundToTwoDecimals,
} from '@/lib/scoring-utils';
import type {AiEstimationResult, AiEstimatorId} from '@/lib/parallel-ai-estimator';

export type AlignedItemScoring = {
  nameAgreement: number;
  weightAgreement: number;
  nutritionAgreement: number;
  overallScore: number;
};

export type CrossValidatedItem = {
  foodName: string;
  quantityDescription: string;
  estimatedGrams: number;
  confidence: number;
  fallbackPer100g: NutritionProfile23;
  scoring: AlignedItemScoring;
  contributingProviders: AiEstimatorId[];
};

export type CrossValidationSummary = {
  totalProviders: number;
  successfulProviders: AiEstimatorId[];
  failedProviders: AiEstimatorId[];
  averageScore: number;
  consensusLevel: 'high' | 'medium' | 'low' | 'degraded';
  items: CrossValidatedItem[];
};

function normalizeForComparison(foodName: string): string {
  return normalizeLookupText(sanitizeFoodName(foodName));
}

function characterBigrams(text: string): Set<string> {
  const bigrams = new Set<string>();
  for (let i = 0; i < text.length - 1; i++) {
    bigrams.add(text.slice(i, i + 2));
  }
  return bigrams;
}

function bigramJaccardSimilarity(a: string, b: string): number {
  const normA = normalizeForComparison(a);
  const normB = normalizeForComparison(b);

  if (normA === normB) {
    return 1;
  }

  if (!normA.length || !normB.length) {
    return 0;
  }

  if (normA.length === 1 && normB.length === 1) {
    return normA === normB ? 1 : 0;
  }

  const bigramsA = characterBigrams(normA);
  const bigramsB = characterBigrams(normB);

  if (!bigramsA.size || !bigramsB.size) {
    return normA === normB ? 1 : 0;
  }

  let intersection = 0;
  for (const bigram of bigramsA) {
    if (bigramsB.has(bigram)) {
      intersection++;
    }
  }

  const union = bigramsA.size + bigramsB.size - intersection;
  return union > 0 ? intersection / union : 0;
}

const ALIGNMENT_THRESHOLD = 0.5;

type AlignedGroup = {
  items: Array<{
    provider: AiEstimatorId;
    item: AiParsedFoodItem;
  }>;
};

function alignItems(results: AiEstimationResult[]): AlignedGroup[] {
  if (results.length === 0) {
    return [];
  }

  if (results.length === 1) {
    return results[0]!.items.map((item) => ({
      items: [{provider: results[0]!.provider, item}],
    }));
  }

  // Use the result with the most items as the reference
  const sorted = [...results].sort((a, b) => b.items.length - a.items.length);
  const reference = sorted[0]!;
  const others = sorted.slice(1);

  const groups: AlignedGroup[] = reference.items.map((item) => ({
    items: [{provider: reference.provider, item}],
  }));

  for (const result of others) {
    const used = new Set<number>();

    for (const group of groups) {
      const refItem = group.items[0]!.item;
      let bestMatch = -1;
      let bestSimilarity = 0;

      for (let j = 0; j < result.items.length; j++) {
        if (used.has(j)) {
          continue;
        }

        const similarity = bigramJaccardSimilarity(
          refItem.foodName,
          result.items[j]!.foodName
        );

        if (similarity > bestSimilarity) {
          bestSimilarity = similarity;
          bestMatch = j;
        }
      }

      if (bestMatch >= 0 && bestSimilarity >= ALIGNMENT_THRESHOLD) {
        group.items.push({provider: result.provider, item: result.items[bestMatch]!});
        used.add(bestMatch);
      }
    }

    // Unmatched items from this result become new groups
    for (let j = 0; j < result.items.length; j++) {
      if (!used.has(j)) {
        groups.push({
          items: [{provider: result.provider, item: result.items[j]!}],
        });
      }
    }
  }

  return groups;
}

function scoreAlignedGroup(group: AlignedGroup): AlignedItemScoring {
  if (group.items.length <= 1) {
    return {
      nameAgreement: 0,
      weightAgreement: 0,
      nutritionAgreement: 0,
      overallScore: 0,
    };
  }

  // Name agreement: pairwise average Jaccard
  const namePairs: number[] = [];
  for (let i = 0; i < group.items.length; i++) {
    for (let j = i + 1; j < group.items.length; j++) {
      namePairs.push(
        bigramJaccardSimilarity(
          group.items[i]!.item.foodName,
          group.items[j]!.item.foodName
        )
      );
    }
  }
  const nameAgreement = roundToTwoDecimals(average(namePairs));

  // Weight agreement: all vs median
  const weights = group.items.map((entry) => entry.item.estimatedGrams);
  const medianWeight = median(weights);
  const weightScores = weights.map((w) => calculateWeightAgreement(w, medianWeight));
  const weightAgreement = roundToTwoDecimals(average(weightScores));

  // Nutrition agreement: all vs consensus
  const profiles = group.items.map((entry) => entry.item.fallbackPer100g);
  const consensusProfile = buildConsensusProfileFromParsed(profiles);
  const nutritionScores = profiles.map((profile) =>
    calculateNutritionAgreement(profile, consensusProfile)
  );
  const nutritionAgreement = roundToTwoDecimals(average(nutritionScores));

  const overallScore = roundToTwoDecimals(
    0.2 * nameAgreement + 0.35 * weightAgreement + 0.45 * nutritionAgreement
  );

  return {nameAgreement, weightAgreement, nutritionAgreement, overallScore};
}

function buildConsensusItem(
  group: AlignedGroup,
  scoring: AlignedItemScoring
): CrossValidatedItem {
  // Food name: pick from the provider with the highest individual confidence,
  // or the first provider if tied
  const bestProvider = group.items.reduce((best, current) =>
    current.item.confidence > best.item.confidence ? current : best
  );

  // Weight: median
  const consensusGrams = Math.max(
    1,
    Math.round(median(group.items.map((entry) => entry.item.estimatedGrams)))
  );

  // Nutrition: consensus of per-100g profiles
  const consensusProfile = buildConsensusProfileFromParsed(
    group.items.map((entry) => entry.item.fallbackPer100g)
  );

  // Confidence: weighted average
  const consensusConfidence = roundToTwoDecimals(
    clamp01(average(group.items.map((entry) => entry.item.confidence)))
  );

  // quantityDescription: pick from the best provider
  const quantityDescription = bestProvider.item.quantityDescription;

  return {
    foodName: bestProvider.item.foodName,
    quantityDescription,
    estimatedGrams: consensusGrams,
    confidence: consensusConfidence,
    fallbackPer100g: consensusProfile,
    scoring,
    contributingProviders: group.items.map((entry) => entry.provider),
  };
}

export function crossValidate(
  results: AiEstimationResult[],
  failures: Array<{provider: AiEstimatorId; error: string}>,
  totalProviders: number
): CrossValidationSummary {
  const successfulProviders = results.map((r) => r.provider);
  const failedProviders = failures.map((f) => f.provider);

  if (results.length === 0) {
    return {
      totalProviders,
      successfulProviders: [],
      failedProviders,
      averageScore: 0,
      consensusLevel: 'degraded',
      items: [],
    };
  }

  // Single result: degraded mode - return as-is with zero scoring
  if (results.length === 1) {
    const singleResult = results[0]!;
    return {
      totalProviders,
      successfulProviders,
      failedProviders,
      averageScore: 0,
      consensusLevel: 'degraded',
      items: singleResult.items.map((item) => ({
        foodName: item.foodName,
        quantityDescription: item.quantityDescription,
        estimatedGrams: item.estimatedGrams,
        confidence: Math.min(item.confidence, 0.6),
        fallbackPer100g: item.fallbackPer100g,
        scoring: {
          nameAgreement: 0,
          weightAgreement: 0,
          nutritionAgreement: 0,
          overallScore: 0,
        },
        contributingProviders: [singleResult.provider],
      })),
    };
  }

  // 2+ results: full cross-validation
  const aligned = alignItems(results);
  const scoredItems: CrossValidatedItem[] = aligned.map((group) => {
    const scoring = scoreAlignedGroup(group);
    return buildConsensusItem(group, scoring);
  });

  const averageScore = roundToTwoDecimals(
    average(scoredItems.map((item) => item.scoring.overallScore))
  );

  let consensusLevel: CrossValidationSummary['consensusLevel'];
  if (averageScore >= 0.8) {
    consensusLevel = 'high';
  } else if (averageScore >= 0.6) {
    consensusLevel = 'medium';
  } else {
    consensusLevel = 'low';
  }

  return {
    totalProviders,
    successfulProviders,
    failedProviders,
    averageScore,
    consensusLevel,
    items: scoredItems,
  };
}
