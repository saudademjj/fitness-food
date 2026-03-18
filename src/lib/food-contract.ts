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
  'db_candidate_rejected',
  'db_candidate_thermodynamic_mismatch',
  'brand_curated_override',
  'portion_reference_applied',
  'portion_keyword_applied',
  'portion_fallback_applied',
  'portion_size_adjusted',
  'portion_preparation_adjusted',
  'composite_total_rebalanced',
  'whole_dish_db_override',
  'whole_dish_component_aligned',
  'runtime_recipe_ingredients',
  'runtime_ai_ingredients',
  'ingredient_ai_macro_estimate',
  'ingredient_reference_micros_merged',
  'low_confidence',
  'ai_macro_unverified',
  'db_micronutrient_gap',
  'db_micronutrient_ai_merged',
  'nutrition_partial',
  'nutrition_unknown',
]);

export const MatchModeSchema = z.enum([
  'exact',
  'fuzzy',
  'ai_fallback',
  'runtime_ingredients',
]);
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

const MacroOnlyProfileSchema = NutritionProfile23Schema.pick({
  energyKcal: true,
  proteinGrams: true,
  carbohydrateGrams: true,
  fatGrams: true,
});

export const AiCompositeDishIngredientSchema = z.object({
  ingredientName: z.string().trim().min(1),
  estimatedGrams: z.coerce.number().positive(),
  confidence: z.coerce.number().min(0).max(1).catch(0.5),
  optional: z.coerce.boolean().default(false),
  fallbackPer100g: MacroOnlyProfileSchema,
});

export const AiCompositeDishBreakdownSchema = z.object({
  dishName: z.string().trim().min(1),
  totalEstimatedGrams: z.coerce.number().positive(),
  confidence: z.coerce.number().min(0).max(1).catch(0.5),
  cookingMethod: z.string().trim().min(1).nullable().optional(),
  ingredients: z.array(AiCompositeDishIngredientSchema).min(1),
});

export const ResolvedFoodItemSchema = z.object({
  foodName: z.string().trim().min(1),
  quantityDescription: z.string().trim().min(1),
  estimatedGrams: z.coerce.number().nonnegative(),
  confidence: z.coerce.number().min(0).max(1),
  sourceKind: z.enum(['recipe', 'catalog', 'ai_fallback', 'runtime_composite']),
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

export const ResolvedFoodItemsSchema = z.array(ResolvedFoodItemSchema);

export const ParseFoodDescriptionSegmentSchema = z.object({
  sourceDescription: z.string().trim().min(1),
  compositeDishName: z.string().trim().min(1).nullable(),
  resolutionKind: z.enum([
    'direct_items',
    'whole_dish_db',
    'runtime_recipe_ingredients',
    'runtime_ai_ingredients',
    'ai_items',
  ]),
  totalNutrition: NutritionProfile23Schema,
  totalNutritionMeta: NutritionProfileMeta23Schema,
  totalWeight: z.coerce.number().nonnegative(),
  overallConfidence: z.coerce.number().min(0).max(1),
  items: ResolvedFoodItemsSchema,
  ingredientBreakdown: ResolvedFoodItemsSchema.default([]),
});

export const ParseFoodDescriptionOutputSchema = z.object({
  compositeDishName: z.string().trim().min(1).nullable(),
  totalNutrition: NutritionProfile23Schema,
  totalNutritionMeta: NutritionProfileMeta23Schema,
  totalWeight: z.coerce.number().nonnegative(),
  overallConfidence: z.coerce.number().min(0).max(1),
  items: ResolvedFoodItemsSchema,
  segments: z.array(ParseFoodDescriptionSegmentSchema).min(1),
});

export {NutritionProfile23Schema, NutritionProfileMeta23Schema, NutrientDatumMetaSchema};
export type ParseFoodDescriptionInput = z.infer<typeof ParseFoodDescriptionInputSchema>;
export type AiParsedFoodItem = z.infer<typeof AiParsedFoodItemSchema>;
export type AiCompositeDishBreakdown = z.infer<typeof AiCompositeDishBreakdownSchema>;
export type AiCompositeDishIngredient = z.infer<typeof AiCompositeDishIngredientSchema>;
export type ParseFoodDescriptionOutput = z.infer<typeof ParseFoodDescriptionOutputSchema>;
export type ParseFoodDescriptionSegment = z.infer<typeof ParseFoodDescriptionSegmentSchema>;
export type ResolvedFoodItem = z.infer<typeof ResolvedFoodItemSchema>;
export type ResolvedFoodItems = z.infer<typeof ResolvedFoodItemsSchema>;
export type ValidationFlag = z.infer<typeof ValidationFlagSchema>;
export type MatchMode = z.infer<typeof MatchModeSchema>;
export type SourceStatus = z.infer<typeof SourceStatusSchema>;
export type {NutritionProfile23, NutritionProfileMeta23};
