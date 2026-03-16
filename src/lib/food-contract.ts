import {z} from 'zod';

const MacroNutrientsSchema = z.object({
  energyKcal: z.coerce.number().nonnegative(),
  proteinGrams: z.coerce.number().nonnegative(),
  carbohydrateGrams: z.coerce.number().nonnegative(),
  fatGrams: z.coerce.number().nonnegative(),
});

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
  fallbackPer100g: MacroNutrientsSchema,
});

export const AiParsedFoodItemsSchema = z.array(AiParsedFoodItemSchema).min(1);

export const ResolvedFoodItemSchema = z.object({
  foodName: z.string().trim().min(1),
  quantityDescription: z.string().trim().min(1),
  estimatedGrams: z.coerce.number().nonnegative(),
  confidence: z.coerce.number().min(0).max(1),
  sourceKind: z.enum(['recipe', 'catalog', 'ai_fallback']),
  sourceLabel: z.string().trim().min(1),
  per100g: MacroNutrientsSchema,
  totals: MacroNutrientsSchema,
});

export const ParseFoodDescriptionOutputSchema = z.array(ResolvedFoodItemSchema);

export type ParseFoodDescriptionInput = z.infer<typeof ParseFoodDescriptionInputSchema>;
export type AiParsedFoodItem = z.infer<typeof AiParsedFoodItemSchema>;
export type ParseFoodDescriptionOutput = z.infer<typeof ParseFoodDescriptionOutputSchema>;
export type ResolvedFoodItem = z.infer<typeof ResolvedFoodItemSchema>;
