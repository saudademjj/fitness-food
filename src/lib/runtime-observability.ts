import {getDbPool} from '@/lib/db';
import type {ParseFoodDescriptionOutput} from '@/lib/food-contract';

export type WeightResolutionTrace = {
  foodName: string;
  quantityDescription: string;
  strategy:
    | 'explicit_metric'
    | 'portion_exact'
    | 'portion_keyword_preferred'
    | 'portion_keyword_ai_preferred'
    | 'portion_fallback_preferred'
    | 'portion_fallback_ai_preferred'
    | 'portion_default';
  portionMatchStrategy: 'exact' | 'keyword' | 'fallback' | 'none';
  aiEstimatedGrams: number | null;
  portionEstimatedGrams: number | null;
  finalEstimatedGrams: number;
  matchedName: string | null;
};

export async function recordFoodParseTelemetry(payload: {
  description: string;
  output: ParseFoodDescriptionOutput;
  weightResolutionTraces: WeightResolutionTrace[];
  secondaryReview?: {
    attempted: boolean;
    succeeded: boolean;
    changedItemCount: number;
    adjustedWeightCount: number;
    adjustedNutritionCount: number;
    failureReason?: string | null;
  };
}): Promise<void> {
  try {
    const pool = getDbPool();
    const itemCount = payload.output.items.length;
    const segmentCount = payload.output.segments.length;
    const compositeSegmentCount = payload.output.segments.filter(
      (segment) => segment.compositeDishName
    ).length;
    const fallbackItemCount = payload.output.items.filter(
      (item) => item.sourceKind === 'ai_fallback'
    ).length;
    const runtimeCompositeCount = payload.output.items.filter(
      (item) => item.sourceKind === 'runtime_composite'
    ).length;
    const exactCount = payload.output.items.filter(
      (item) => item.matchMode === 'exact'
    ).length;
    const fuzzyCount = payload.output.items.filter(
      (item) => item.matchMode === 'fuzzy'
    ).length;

    await pool.query(
      `
        INSERT INTO app.food_parse_telemetry (
          source_description,
          segment_count,
          item_count,
          composite_segment_count,
          db_exact_item_count,
          db_fuzzy_item_count,
          ai_fallback_item_count,
          runtime_composite_item_count,
          total_weight_g,
          overall_confidence,
          total_energy_kcal,
          metrics
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)
      `,
      [
        payload.description,
        segmentCount,
        itemCount,
        compositeSegmentCount,
        exactCount,
        fuzzyCount,
        fallbackItemCount,
        runtimeCompositeCount,
        payload.output.totalWeight,
        payload.output.overallConfidence,
        payload.output.totalNutrition.energyKcal,
        JSON.stringify({
          segments: payload.output.segments,
          weightResolutionTraces: payload.weightResolutionTraces,
          sourceKinds: payload.output.items.map((item) => item.sourceKind),
          validationFlags: payload.output.items.flatMap((item) => item.validationFlags),
          secondaryReview: payload.secondaryReview ?? null,
        }),
      ]
    );
  } catch {
    // Observability must never block user-visible parsing.
  }
}

export async function recordRuntimeError(payload: {
  scope: string;
  code: string;
  message: string;
  context?: Record<string, unknown>;
}): Promise<void> {
  try {
    const pool = getDbPool();
    await pool.query(
      `
        INSERT INTO app.runtime_error_telemetry (
          scope,
          error_code,
          message,
          context
        )
        VALUES ($1, $2, $3, $4::jsonb)
      `,
      [
        payload.scope,
        payload.code,
        payload.message,
        JSON.stringify(payload.context ?? {}),
      ]
    );
  } catch {
    // Error telemetry must never raise a secondary error.
  }
}
