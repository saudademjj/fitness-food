import {getDbPool} from '@/lib/db';
import {
  type AiCompositeDishBreakdown,
  type ParseFoodDescriptionSegment,
  type ResolvedFoodItem,
  type ResolvedFoodItems,
} from '@/lib/food-contract';
import {parseCompositeDishWithPrimaryModel} from '@/lib/primary-model';
import {mapRowToLookupResult, type CatalogRow, type NutritionLookupResolver, type NutritionLookupResult} from '@/lib/nutrition-db';
import {
  aggregateNutritionProfiles,
  cloneNutritionProfileMeta,
  convertTotalsToPer100g,
  createNutritionProfile,
  createNutritionProfileMeta,
  scaleNutritionProfile,
  type NutritionProfile23,
  type NutritionProfileMeta23,
} from '@/lib/nutrition-profile';
import {buildResolvedFood, createMacroOnlyAiMeta} from '@/lib/resolved-food';
import {estimateGrams} from '@/lib/portion-reference';
import {dedupeValidationFlags} from '@/lib/validation';

type CompositeDishCandidate = {
  foodName: string;
  quantityDescription: string;
};

type RecipeIngredientLookupRow = CatalogRow & {
  line_no: number;
  recipe_name_zh: string;
  recipe_amount_basis_g: number | null;
  ingredient_display_name: string;
  ingredient_amount_g: number;
  optional: boolean;
  match_confidence: number | null;
};

function round(value: number): number {
  return Number(value.toFixed(1));
}

function buildCompositeConfidence(
  items: ResolvedFoodItems,
  fallbackConfidence: number
): number {
  const totalWeight = items.reduce((sum, item) => sum + item.estimatedGrams, 0);
  if (!totalWeight) {
    return fallbackConfidence;
  }

  const weightedConfidence = items.reduce(
    (sum, item) => sum + item.confidence * item.estimatedGrams,
    0
  );
  return Math.min(0.95, round(weightedConfidence / totalWeight));
}

function summarizeCompositeTotals(items: ResolvedFoodItems) {
  const totalWeight = items.reduce((sum, item) => sum + item.estimatedGrams, 0);
  const aggregated = aggregateNutritionProfiles(
    items.map((item) => ({
      profile: item.totals,
      meta: item.totalsMeta,
    }))
  );

  return {
    totalWeight,
    totalNutrition: aggregated.profile,
    totalNutritionMeta: aggregated.meta,
  };
}

function scaleResolvedFoodItem(item: ResolvedFoodItem, targetGrams: number): ResolvedFoodItem {
  return {
    ...item,
    estimatedGrams: targetGrams,
    totals: scaleNutritionProfile(item.per100g, targetGrams),
    totalsMeta: cloneNutritionProfileMeta(item.per100gMeta),
  };
}

function rebalanceIngredientItems(
  items: ResolvedFoodItems,
  targetTotalGrams: number
): ResolvedFoodItems {
  const currentTotal = items.reduce((sum, item) => sum + item.estimatedGrams, 0);
  if (!targetTotalGrams || !currentTotal || Math.abs(currentTotal - targetTotalGrams) < 1) {
    return items;
  }

  return items.map((item, index) => {
    const rawValue = (item.estimatedGrams / currentTotal) * targetTotalGrams;
    const nextGrams =
      index === items.length - 1
        ? Math.max(
            1,
            Math.round(
              targetTotalGrams -
                items
                  .slice(0, -1)
                  .reduce(
                    (sum, currentItem) =>
                      sum + Math.max(1, Math.round((currentItem.estimatedGrams / currentTotal) * targetTotalGrams)),
                    0
                  )
            )
          )
        : Math.max(1, Math.round(rawValue));

    return scaleResolvedFoodItem(item, nextGrams);
  });
}

function buildCompositeAggregateItem(
  candidate: CompositeDishCandidate,
  ingredientBreakdown: ResolvedFoodItems,
  sourceLabel: string,
  validationFlags: ResolvedFoodItem['validationFlags'],
  confidence: number
): ResolvedFoodItem {
  const summary = summarizeCompositeTotals(ingredientBreakdown);
  const per100g = convertTotalsToPer100g(summary.totalNutrition, summary.totalWeight || 100);
  const per100gMeta = createNutritionProfileMeta(
    Object.keys(summary.totalNutritionMeta).reduce<Partial<NutritionProfileMeta23>>((acc, key) => {
      const typedKey = key as keyof NutritionProfileMeta23;
      acc[typedKey] =
        summary.totalNutritionMeta[typedKey].status === 'missing'
          ? summary.totalNutritionMeta[typedKey]
          : {
              status: 'estimated',
              source: summary.totalNutritionMeta[typedKey].source,
            };
      return acc;
    }, {})
  );
  const sourceStatus =
    ingredientBreakdown.some((item) => item.sourceStatus === 'preview' || item.sourceKind === 'ai_fallback')
      ? 'preview'
      : 'published';
  const aggregateFlags = dedupeValidationFlags([
    ...validationFlags,
    ...(summary.totalNutritionMeta.energyKcal.status === 'missing'
      ? (['nutrition_unknown'] as const)
      : []),
    ...(
      Object.values(summary.totalNutritionMeta).some((meta) => meta.status === 'partial')
        ? (['nutrition_partial'] as const)
        : []
    ),
    ...(confidence < 0.65 ? (['low_confidence'] as const) : []),
  ]);

  return {
    foodName: candidate.foodName,
    quantityDescription: candidate.quantityDescription,
    estimatedGrams: summary.totalWeight,
    confidence,
    sourceKind: 'runtime_composite',
    sourceLabel,
    matchMode: 'runtime_ingredients',
    sourceStatus,
    amountBasisG: 100,
    validationFlags: aggregateFlags,
    per100g,
    per100gMeta,
    totals: summary.totalNutrition,
    totalsMeta: summary.totalNutritionMeta,
  };
}

function buildCompositeSegment(
  candidate: CompositeDishCandidate,
  ingredientBreakdown: ResolvedFoodItems,
  resolutionKind: ParseFoodDescriptionSegment['resolutionKind'],
  sourceLabel: string,
  validationFlags: ResolvedFoodItem['validationFlags'],
  fallbackConfidence: number
): ParseFoodDescriptionSegment {
  const confidence = buildCompositeConfidence(ingredientBreakdown, fallbackConfidence);
  const aggregateItem = buildCompositeAggregateItem(
    candidate,
    ingredientBreakdown,
    sourceLabel,
    validationFlags,
    confidence
  );

  return {
    sourceDescription: candidate.quantityDescription === '未知'
      ? candidate.foodName
      : `${candidate.quantityDescription}${candidate.foodName}`,
    compositeDishName: candidate.foodName,
    resolutionKind,
    totalNutrition: aggregateItem.totals,
    totalNutritionMeta: aggregateItem.totalsMeta,
    totalWeight: aggregateItem.estimatedGrams,
    overallConfidence: aggregateItem.confidence,
    items: [aggregateItem],
    ingredientBreakdown,
  };
}

async function queryRecipeIngredients(recipeId: string): Promise<RecipeIngredientLookupRow[]> {
  const pool = getDbPool();
  const result = await pool.query<RecipeIngredientLookupRow>(
    `
      SELECT
        'food'::text AS entity_type,
        afp.canonical_food_id::text AS entity_id,
        NULL::text AS entity_slug,
        afp.food_name_zh,
        afp.food_name_en,
        COALESCE(afp.source_system, ri.ingredient_source_system) AS source_system,
        afp.source_food_id AS source_item_id,
        afp.food_group,
        afp.source_category,
        afp.source_subcategory,
        afp.energy_kcal,
        afp.protein_grams,
        afp.carbohydrate_grams,
        afp.fat_grams,
        afp.fiber_grams,
        afp.sugars_grams,
        afp.sodium_mg,
        afp.potassium_mg,
        afp.calcium_mg,
        afp.magnesium_mg,
        afp.iron_mg,
        afp.zinc_mg,
        afp.vitamin_a_mcg,
        afp.vitamin_c_mg,
        afp.vitamin_d_mcg,
        afp.vitamin_e_mg,
        afp.vitamin_k_mcg,
        afp.thiamin_mg,
        afp.riboflavin_mg,
        afp.niacin_mg,
        afp.vitamin_b6_mg,
        afp.vitamin_b12_mcg,
        afp.folate_mcg,
        afp.energy_kcal_is_present,
        afp.protein_grams_is_present,
        afp.carbohydrate_grams_is_present,
        afp.fat_grams_is_present,
        afp.fiber_grams_is_present,
        afp.sugars_grams_is_present,
        afp.sodium_mg_is_present,
        afp.potassium_mg_is_present,
        afp.calcium_mg_is_present,
        afp.magnesium_mg_is_present,
        afp.iron_mg_is_present,
        afp.zinc_mg_is_present,
        afp.vitamin_a_mcg_is_present,
        afp.vitamin_c_mg_is_present,
        afp.vitamin_d_mcg_is_present,
        afp.vitamin_e_mg_is_present,
        afp.vitamin_k_mcg_is_present,
        afp.thiamin_mg_is_present,
        afp.riboflavin_mg_is_present,
        afp.niacin_mg_is_present,
        afp.vitamin_b6_mg_is_present,
        afp.vitamin_b12_mcg_is_present,
        afp.folate_mcg_is_present,
        COALESCE(afp.amount_basis_g, 100) AS amount_basis_g,
        COALESCE(afp.publish_ready, FALSE) AS publish_ready,
        afp.completeness_ratio,
        afp.macro_present_count,
        afp.non_core_present_count,
        afp.measured_nutrient_count,
        ri.line_no,
        r.recipe_name_zh,
        r.amount_basis_g AS recipe_amount_basis_g,
        COALESCE(ri.ingredient_name_zh, ri.ingredient_name) AS ingredient_display_name,
        ri.ingredient_amount_g,
        ri.optional,
        ri.match_confidence
      FROM core.recipe_ingredient ri
      JOIN core.recipe r
        ON r.id = ri.recipe_id
      LEFT JOIN core.source_food sf
        ON sf.source_release_id = ri.ingredient_source_release_id
       AND sf.source_food_id = ri.ingredient_source_food_id
       AND sf.source_system = ri.ingredient_source_system
      LEFT JOIN core.canonical_food cf
        ON cf.primary_source_food_pk = sf.id
      LEFT JOIN core.app_food_profile_23 afp
        ON afp.canonical_food_id = cf.id
      WHERE ri.recipe_id = $1::uuid
      ORDER BY ri.line_no ASC
    `,
    [recipeId]
  );

  return result.rows;
}

function createFallbackProfileFromMacros(
  breakdown: AiCompositeDishBreakdown['ingredients'][number]
): NutritionProfile23 {
  return createNutritionProfile({
    energyKcal: breakdown.fallbackPer100g.energyKcal,
    proteinGrams: breakdown.fallbackPer100g.proteinGrams,
    carbohydrateGrams: breakdown.fallbackPer100g.carbohydrateGrams,
    fatGrams: breakdown.fallbackPer100g.fatGrams,
  });
}

async function resolveIngredientItem(
  ingredient: {
    foodName: string;
    estimatedGrams: number;
    confidence: number;
    optional?: boolean;
    fallbackPer100g: NutritionProfile23;
  },
  lookupResolver: NutritionLookupResolver,
  extraValidationFlags: ResolvedFoodItem['validationFlags']
): Promise<ResolvedFoodItem> {
  const dbMatch = await lookupResolver(ingredient.foodName, {
    allowFuzzy: true,
    recordMiss: true,
  });

  return buildResolvedFood({
    foodName: ingredient.foodName,
    quantityDescription: `${ingredient.estimatedGrams}g`,
    estimatedGrams: ingredient.estimatedGrams,
    confidence: ingredient.confidence,
    dbMatch,
    fallbackPer100g: ingredient.fallbackPer100g,
    fallbackPer100gMeta: createMacroOnlyAiMeta(),
    validationFlags: extraValidationFlags,
    fallbackValidationFlags: ['ingredient_ai_macro_estimate', 'db_lookup_miss'],
    fallbackSourceLabel: `AI 原料宏量估算 · ${ingredient.foodName}`,
    fallbackConfidenceCap: ingredient.optional ? 0.42 : 0.5,
  });
}

export async function resolveCompositeDishFromRecipe(
  candidate: CompositeDishCandidate,
  recipeMatch: NutritionLookupResult,
  lookupResolver: NutritionLookupResolver
): Promise<ParseFoodDescriptionSegment | null> {
  if (recipeMatch.sourceKind !== 'recipe' || !recipeMatch.entityId) {
    return null;
  }

  const recipeRows = await queryRecipeIngredients(recipeMatch.entityId);
  if (!recipeRows.length) {
    return null;
  }

  const estimatedDish = await estimateGrams(
    candidate.foodName,
    candidate.quantityDescription,
    recipeMatch.matchedName
  );
  const baseWeight = recipeRows.reduce(
    (sum, row) => sum + Number(row.ingredient_amount_g ?? 0),
    0
  );
  const targetWeight = estimatedDish.grams > 0 ? estimatedDish.grams : baseWeight || 100;

  const ingredientBreakdown = await Promise.all(
    recipeRows.map(async (row) => {
      const scaledGrams = Math.max(
        1,
        Math.round((Number(row.ingredient_amount_g ?? 0) / Math.max(baseWeight, 1)) * targetWeight)
      );
      const directMatch =
        row.entity_id && row.food_name_zh
          ? mapRowToLookupResult(row, 'exact')
          : await lookupResolver(row.ingredient_display_name, {
              allowFuzzy: true,
              recordMiss: true,
            });

      return buildResolvedFood({
        foodName: row.ingredient_display_name,
        quantityDescription: `${scaledGrams}g`,
        estimatedGrams: scaledGrams,
        confidence: Math.min(0.98, Number(row.match_confidence ?? 0.9)),
        dbMatch: directMatch,
        fallbackPer100g: createNutritionProfile(),
        validationFlags: row.optional ? [] : [],
        fallbackValidationFlags: ['db_lookup_miss'],
        fallbackSourceLabel: `菜谱原料缺少营养数据 · ${row.ingredient_display_name}`,
        fallbackConfidenceCap: 0.35,
      });
    })
  );

  return buildCompositeSegment(
    {
      ...candidate,
      quantityDescription: candidate.quantityDescription,
    },
    rebalanceIngredientItems(ingredientBreakdown, targetWeight),
    'runtime_recipe_ingredients',
    `运行时菜谱原料聚算 · ${recipeMatch.matchedName}`,
    dedupeValidationFlags([
      ...recipeMatch.validationFlags,
      ...estimatedDish.validationFlags,
      'runtime_recipe_ingredients',
    ]),
    Math.min(0.96, recipeMatch.matchMode === 'exact' ? 0.94 : 0.86)
  );
}

export async function resolveCompositeDishWithAiIngredients(
  candidate: CompositeDishCandidate,
  lookupResolver: NutritionLookupResolver
): Promise<ParseFoodDescriptionSegment> {
  const breakdown = await parseCompositeDishWithPrimaryModel(candidate.foodName);
  const targetWeightEstimate = await estimateGrams(candidate.foodName, candidate.quantityDescription);
  const targetWeight =
    targetWeightEstimate.grams > 0
      ? targetWeightEstimate.grams
      : breakdown.totalEstimatedGrams;

  const ingredientBreakdown = await Promise.all(
    breakdown.ingredients.map((ingredient) =>
      resolveIngredientItem(
        {
          foodName: ingredient.ingredientName,
          estimatedGrams: ingredient.estimatedGrams,
          confidence: ingredient.confidence,
          optional: ingredient.optional,
          fallbackPer100g: createFallbackProfileFromMacros(ingredient),
        },
        lookupResolver,
        []
      )
    )
  );

  return buildCompositeSegment(
    {
      foodName: breakdown.dishName || candidate.foodName,
      quantityDescription: candidate.quantityDescription,
    },
    rebalanceIngredientItems(ingredientBreakdown, targetWeight),
    'runtime_ai_ingredients',
    `AI 拆解原料聚算 · ${candidate.foodName}`,
    dedupeValidationFlags([
      ...targetWeightEstimate.validationFlags,
      'runtime_ai_ingredients',
    ]),
    Math.min(0.78, breakdown.confidence)
  );
}
