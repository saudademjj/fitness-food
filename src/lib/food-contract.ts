import {z} from 'zod';

const NutritionProfile23Schema = z.object({
  energyKcal: z.coerce.number().nonnegative(),
  proteinGrams: z.coerce.number().nonnegative(),
  carbohydrateGrams: z.coerce.number().nonnegative(),
  fatGrams: z.coerce.number().nonnegative(),
  fiberGrams: z.coerce.number().nonnegative(),
  sugarsGrams: z.coerce.number().nonnegative(),
  sodiumMg: z.coerce.number().nonnegative(),
  potassiumMg: z.coerce.number().nonnegative(),
  calciumMg: z.coerce.number().nonnegative(),
  magnesiumMg: z.coerce.number().nonnegative(),
  ironMg: z.coerce.number().nonnegative(),
  zincMg: z.coerce.number().nonnegative(),
  vitaminAMcg: z.coerce.number().nonnegative(),
  vitaminCMg: z.coerce.number().nonnegative(),
  vitaminDMcg: z.coerce.number().nonnegative(),
  vitaminEMg: z.coerce.number().nonnegative(),
  vitaminKMcg: z.coerce.number().nonnegative(),
  thiaminMg: z.coerce.number().nonnegative(),
  riboflavinMg: z.coerce.number().nonnegative(),
  niacinMg: z.coerce.number().nonnegative(),
  vitaminB6Mg: z.coerce.number().nonnegative(),
  vitaminB12Mcg: z.coerce.number().nonnegative(),
  folateMcg: z.coerce.number().nonnegative(),
});

export const ValidationFlagSchema = z.enum([
  'ai_macro_estimate',
  'ai_macro_clamped',
  'db_lookup_miss',
  'portion_reference_applied',
  'portion_keyword_applied',
  'portion_size_adjusted',
  'portion_preparation_adjusted',
  'composite_total_rebalanced',
  'whole_dish_db_override',
  'whole_dish_component_aligned',
  'low_confidence',
  'ai_macro_unverified',
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
  totals: NutritionProfile23Schema,
});

export const ParseFoodDescriptionOutputSchema = z.array(ResolvedFoodItemSchema);

export {NutritionProfile23Schema};
export type ParseFoodDescriptionInput = z.infer<typeof ParseFoodDescriptionInputSchema>;
export type AiParsedFoodItem = z.infer<typeof AiParsedFoodItemSchema>;
export type ParseFoodDescriptionOutput = z.infer<typeof ParseFoodDescriptionOutputSchema>;
export type ResolvedFoodItem = z.infer<typeof ResolvedFoodItemSchema>;
export type ValidationFlag = z.infer<typeof ValidationFlagSchema>;
export type MatchMode = z.infer<typeof MatchModeSchema>;
export type SourceStatus = z.infer<typeof SourceStatusSchema>;
export type NutritionProfile23 = z.infer<typeof NutritionProfile23Schema>;
