
'use server';
import {
  ParseFoodDescriptionInputSchema,
  ParseFoodDescriptionOutputSchema,
  type AiParsedFoodItem,
  type ResolvedFoodItem,
  type ParseFoodDescriptionInput,
  type ParseFoodDescriptionOutput,
} from '@/lib/food-contract';
import {tryResolveDirectDescription} from '@/lib/direct-food-parser';
import {scaleMacros} from '@/lib/macros';
import {
  lookupNutritionByNameExact,
  lookupNutritionByNameFuzzy,
  type NutritionLookupResult,
} from '@/lib/nutrition-db';
import {parseFoodCandidatesWithGemini} from '@/lib/gemini';

const COMPOSITE_FOOD_PATTERN =
  /(炒饭|蛋炒饭|盖饭|拌饭|焖饭|烩饭|煲仔饭|焗饭|炒面|拌面|汤面|拉面|米线|河粉|炒粉|意面|三明治|汉堡|披萨|卷饼|卷|沙拉|套餐|便当|拼盘|汤|火锅|麻辣烫|冒菜|砂锅|小炒|炒菜|鸡丁|肉末|盖浇)/i;
const UNSAFE_FUZZY_MATCH_PATTERN =
  /(婴儿|婴幼儿|快餐|三明治|卷饼|汤|罐装|填料|调味|混合|饼干|松饼|百吉饼|潜艇|咖喱|餐厅|冷冻|晚餐|早餐|幼儿|泥|面包|汉堡)/i;

function sanitizeFoodName(foodName: string): string {
  return foodName
    .normalize('NFKC')
    .replace(/^[的了又还和与及、，,\s]+/g, '')
    .replace(/[，,。.!！?？]+$/g, '')
    .trim();
}

function sanitizeCandidate(candidate: AiParsedFoodItem): AiParsedFoodItem {
  return {
    ...candidate,
    foodName: sanitizeFoodName(candidate.foodName),
    quantityDescription: candidate.quantityDescription.trim() || '未知',
  };
}

function isLikelyCompositeFood(foodName: string): boolean {
  return COMPOSITE_FOOD_PATTERN.test(foodName);
}

function shouldAllowFuzzyMatch(foodName: string): boolean {
  return !isLikelyCompositeFood(foodName);
}

function isSafeFuzzyMatch(foodName: string, matchedName: string): boolean {
  const normalizedFoodName = sanitizeFoodName(foodName);
  const normalizedMatchedName = sanitizeFoodName(matchedName);

  if (!normalizedFoodName || !normalizedMatchedName) {
    return false;
  }

  if (UNSAFE_FUZZY_MATCH_PATTERN.test(normalizedMatchedName)) {
    return false;
  }

  return (
    normalizedMatchedName === normalizedFoodName ||
    normalizedMatchedName.startsWith(normalizedFoodName) ||
    normalizedFoodName.startsWith(normalizedMatchedName)
  );
}

function buildResolvedFood(
  candidate: AiParsedFoodItem,
  dbMatch: NutritionLookupResult | null,
  overrides?: Partial<ResolvedFoodItem>
): ResolvedFoodItem {
  const per100g = dbMatch?.per100g ?? candidate.fallbackPer100g;
  return {
    foodName: overrides?.foodName ?? candidate.foodName,
    quantityDescription: overrides?.quantityDescription ?? candidate.quantityDescription,
    estimatedGrams: overrides?.estimatedGrams ?? candidate.estimatedGrams,
    confidence: overrides?.confidence ?? candidate.confidence,
    sourceKind: overrides?.sourceKind ?? dbMatch?.sourceKind ?? 'ai_fallback',
    sourceLabel: overrides?.sourceLabel ?? dbMatch?.sourceLabel ?? 'AI 估算',
    per100g,
    totals:
      overrides?.totals ??
      scaleMacros(per100g, overrides?.estimatedGrams ?? candidate.estimatedGrams),
  };
}

async function resolveCandidate(candidate: AiParsedFoodItem): Promise<ResolvedFoodItem[]> {
  const normalizedCandidate = sanitizeCandidate(candidate);
  const exactMatch = await lookupNutritionByNameExact(normalizedCandidate.foodName);
  if (exactMatch) {
    return [buildResolvedFood(normalizedCandidate, exactMatch)];
  }

  const fuzzyCandidate = shouldAllowFuzzyMatch(normalizedCandidate.foodName)
    ? await lookupNutritionByNameFuzzy(normalizedCandidate.foodName)
    : null;
  const fuzzyMatch =
    fuzzyCandidate &&
    isSafeFuzzyMatch(normalizedCandidate.foodName, fuzzyCandidate.matchedName)
      ? fuzzyCandidate
      : null;

  return [buildResolvedFood(normalizedCandidate, fuzzyMatch)];
}

export async function parseFoodDescription(
  input: ParseFoodDescriptionInput
): Promise<ParseFoodDescriptionOutput> {
  const parsedInput = ParseFoodDescriptionInputSchema.parse(input);
  const directlyResolvedFoods = await tryResolveDirectDescription(parsedInput.description);
  if (directlyResolvedFoods?.length) {
    return ParseFoodDescriptionOutputSchema.parse(directlyResolvedFoods);
  }

  const candidates = await parseFoodCandidatesWithGemini(parsedInput.description);
  const resolvedFoods = (await Promise.all(candidates.map(resolveCandidate))).flat();

  return ParseFoodDescriptionOutputSchema.parse(resolvedFoods);
}
