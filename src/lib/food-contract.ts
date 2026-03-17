import {z} from 'zod';

import {
  NUTRITION_PROFILE_KEYS,
  type NutritionFieldKey,
  type NutritionProfile23,
  type NutritionProfileMeta23,
} from '@/lib/nutrition-profile';

const NullableNutritionNumberSchema = z.preprocess(
  (value) => (value === '' || value === undefined ? null : value),
  z.union([z.coerce.number().nonnegative(), z.null()])
);

const NutritionProfile23Schema = z.object(
  NUTRITION_PROFILE_KEYS.reduce<Record<NutritionFieldKey, typeof NullableNutritionNumberSchema>>(
    (acc, key) => {
      acc[key] = NullableNutritionNumberSchema;
      return acc;
    },
    {} as Record<NutritionFieldKey, typeof NullableNutritionNumberSchema>
  )
);

const NutrientDatumMetaSchema = z.object({
  status: z.enum(['measured', 'estimated', 'partial', 'missing']),
  source: z.enum(['database', 'ai', 'database+ai', 'mixed']),
});

const NutritionProfileMeta23Schema = z.object(
  NUTRITION_PROFILE_KEYS.reduce<Record<NutritionFieldKey, typeof NutrientDatumMetaSchema>>(
    (acc, key) => {
      acc[key] = NutrientDatumMetaSchema;
      return acc;
    },
    {} as Record<NutritionFieldKey, typeof NutrientDatumMetaSchema>
  )
);

export const ValidationFlagSchema = z.enum([
  'ai_macro_estimate',
  'ai_macro_clamped',
  'db_lookup_miss',
  'portion_reference_applied',
  'portion_keyword_applied',
  'portion_fallback_applied',
  'portion_size_adjusted',
  'portion_preparation_adjusted',
  'composite_total_rebalanced',
  'whole_dish_db_override',
  'whole_dish_component_aligned',
  'low_confidence',
  'ai_macro_unverified',
  'db_micronutrient_gap',
  'db_micronutrient_ai_merged',
  'nutrition_partial',
  'nutrition_unknown',
]);

export const MatchModeSchema = z.enum(['exact', 'fuzzy', 'ai_fallback']);
export const SourceStatusSchema = z.enum(['published', 'preview']);

export const ParseFoodDescriptionInputSchema = z.object({
  description: z
    .string()
    .trim()
    .min(1)
    .describe('A natural language description of one or more foods the user has eaten.'),
});

export const AiParsedFoodItemSchema = z.object({
  foodName: z.string().trim().min(1),
  quantityDescription: z.string().trim().min(1).catch('未知'),
  estimatedGrams: z.coerce.number().positive().catch(100),
  confidence: z.coerce.number().min(0).max(1).catch(0.5),
  fallbackPer100g: NutritionProfile23Schema,
  fallbackPer100gMeta: NutritionProfileMeta23Schema.optional(),
  fallbackAdjusted: z.coerce.boolean().default(false),
  fallbackValidationIssues: z.array(z.string()).default([]),
});

export const AiParsedFoodItemsSchema = z.array(AiParsedFoodItemSchema).min(1);

export const ResolvedFoodItemSchema = z.object({
  foodName: z.string().trim().min(1),
  quantityDescription: z.string().trim().min(1),
  estimatedGrams: z.coerce.number().nonnegative(),
  confidence: z.coerce.number().min(0).max(1),
  sourceKind: z.enum(['recipe', 'catalog', 'ai_fallback']),
  sourceLabel: z.string().trim().min(1),
  matchMode: MatchModeSchema,
  sourceStatus: SourceStatusSchema,
  amountBasisG: z.coerce.number().positive().default(100),
  validationFlags: z.array(ValidationFlagSchema).default([]),
  per100g: NutritionProfile23Schema,
  per100gMeta: NutritionProfileMeta23Schema,
  totals: NutritionProfile23Schema,
  totalsMeta: NutritionProfileMeta23Schema,
});

export const ParseFoodDescriptionOutputSchema = z.array(ResolvedFoodItemSchema);

export {NutritionProfile23Schema, NutritionProfileMeta23Schema, NutrientDatumMetaSchema};
export type ParseFoodDescriptionInput = z.infer<typeof ParseFoodDescriptionInputSchema>;
export type AiParsedFoodItem = z.infer<typeof AiParsedFoodItemSchema>;
export type ParseFoodDescriptionOutput = z.infer<typeof ParseFoodDescriptionOutputSchema>;
export type ResolvedFoodItem = z.infer<typeof ResolvedFoodItemSchema>;
export type ValidationFlag = z.infer<typeof ValidationFlagSchema>;
export type MatchMode = z.infer<typeof MatchModeSchema>;
export type SourceStatus = z.infer<typeof SourceStatusSchema>;
export type {NutritionProfile23, NutritionProfileMeta23};
