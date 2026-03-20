import type {AiReviewedFoodItem} from '@/lib/food-contract';
import {
  createNutritionProfile,
  NUTRITION_PROFILE_KEYS,
  type NutritionProfile23,
} from '@/lib/nutrition-profile';

export function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);

  if (!sorted.length) {
    return 0;
  }

  if (sorted.length % 2 === 1) {
    return sorted[middle]!;
  }

  return (sorted[middle - 1]! + sorted[middle]!) / 2;
}

export function average(values: number[]): number {
  if (!values.length) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function clamp01(value: number): number {
  if (value <= 0) {
    return 0;
  }
  if (value >= 1) {
    return 1;
  }
  return value;
}

export function roundToSingleDecimal(value: number): number {
  return Number(value.toFixed(1));
}

export function roundToTwoDecimals(value: number): number {
  return Number(value.toFixed(2));
}

const CORE_REVIEW_KEYS = [
  'energyKcal',
  'proteinGrams',
  'carbohydrateGrams',
  'fatGrams',
] as const;

export function calculateRelativeAgreement(
  value: number,
  baseline: number,
  tolerance: number,
  floor: number
): number {
  const delta = Math.abs(value - baseline) / Math.max(Math.abs(baseline), floor);
  return roundToTwoDecimals(clamp01(1 - delta / tolerance));
}

export function calculateWeightAgreement(reviewWeight: number, finalWeight: number): number {
  return calculateRelativeAgreement(reviewWeight, finalWeight, 0.4, 25);
}

export function calculateNutritionAgreement(
  reviewProfile: NutritionProfile23,
  consensusProfile: NutritionProfile23
): number {
  const scores = CORE_REVIEW_KEYS.map((key) => {
    const reviewValue = reviewProfile[key];
    const consensusValue = consensusProfile[key];
    if (typeof reviewValue !== 'number' || typeof consensusValue !== 'number') {
      return 0.5;
    }

    if (key === 'energyKcal') {
      return calculateRelativeAgreement(reviewValue, consensusValue, 0.45, 30);
    }

    return calculateRelativeAgreement(reviewValue, consensusValue, 0.5, 3);
  });

  return roundToTwoDecimals(average(scores));
}

export function buildConsensusProfile(
  reviewItems: Array<Pick<AiReviewedFoodItem, 'reviewedPer100g'>>
): NutritionProfile23 {
  return createNutritionProfile(
    NUTRITION_PROFILE_KEYS.reduce<Partial<NutritionProfile23>>((acc, key) => {
      const values = reviewItems
        .map((review) => review.reviewedPer100g[key])
        .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));

      acc[key] = values.length ? roundToSingleDecimal(median(values)) : null;
      return acc;
    }, {})
  );
}

export function buildConsensusProfileFromParsed(
  profiles: NutritionProfile23[]
): NutritionProfile23 {
  return createNutritionProfile(
    NUTRITION_PROFILE_KEYS.reduce<Partial<NutritionProfile23>>((acc, key) => {
      const values = profiles
        .map((profile) => profile[key])
        .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));

      acc[key] = values.length ? roundToSingleDecimal(median(values)) : null;
      return acc;
    }, {})
  );
}
