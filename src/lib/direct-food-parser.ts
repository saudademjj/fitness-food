import type {ParseFoodDescriptionOutput} from '@/lib/food-contract';
import {scaleMacros} from '@/lib/macros';
import {
  lookupNutritionByNameExact,
  lookupNutritionByNameFuzzy,
} from '@/lib/nutrition-db';

type PortionProfile = {
  keywords: RegExp;
  defaultGrams: number;
  units?: Partial<Record<string, number>>;
};

const DIRECT_PARSE_MAX_LENGTH = 28;
const MULTI_ITEM_SEPARATOR = /[，,、；;\/]|(?:和|以及|还有|外加|配上|搭配|跟)/;
const COMPOSITE_FOOD_PATTERN =
  /(炒饭|蛋炒饭|盖饭|拌饭|焖饭|烩饭|煲仔饭|焗饭|炒面|拌面|汤面|拉面|米线|河粉|炒粉|意面|三明治|汉堡|披萨|卷饼|卷|沙拉|套餐|便当|拼盘|汤|火锅|麻辣烫|冒菜|砂锅|小炒|炒菜|鸡丁|肉末|盖浇)/i;
const UNSAFE_FUZZY_MATCH_PATTERN =
  /(婴儿|婴幼儿|快餐|三明治|卷饼|汤|罐装|填料|调味|混合|饼干|松饼|百吉饼|潜艇|咖喱|餐厅|冷冻|晚餐|早餐|幼儿|泥|面包|汉堡)/i;
const QUANTITY_PATTERN =
  /(?:约|大约|差不多|大概)?\s*(?:\d+(?:\.\d+)?|半|两|[零一二三四五六七八九十百]+)\s*(?:个|只|颗|块|片|杯|碗|份|盘|盒|瓶|袋|串|根|条|勺|ml|毫升|g|克)/g;
const PREFIX_QUANTITY_PATTERN =
  /^((?:约|大约|差不多|大概)?\s*(?:\d+(?:\.\d+)?|半|两|[零一二三四五六七八九十百]+)\s*(?:个|只|颗|块|片|杯|碗|份|盘|盒|瓶|袋|串|根|条|勺|ml|毫升|g|克))\s*(.+)$/i;
const SUFFIX_QUANTITY_PATTERN =
  /^(.+?)\s*((?:\d+(?:\.\d+)?|半|两|[零一二三四五六七八九十百]+)\s*(?:g|克|ml|毫升))$/i;
const MULTI_SEGMENT_PATTERN =
  /((?:约|大约|差不多|大概)?\s*(?:\d+(?:\.\d+)?|半|两|[零一二三四五六七八九十百]+)\s*(?:个|只|颗|块|片|杯|碗|份|盘|盒|瓶|袋|串|根|条|勺|ml|毫升|g|克))\s*(.*?)(?=(?:约|大约|差不多|大概)?\s*(?:\d+(?:\.\d+)?|半|两|[零一二三四五六七八九十百]+)\s*(?:个|只|颗|块|片|杯|碗|份|盘|盒|瓶|袋|串|根|条|勺|ml|毫升|g|克)|$)/g;

const GENERIC_UNIT_GRAMS: Record<string, number> = {
  个: 100,
  只: 90,
  颗: 15,
  块: 60,
  片: 25,
  杯: 250,
  碗: 200,
  份: 180,
  盘: 220,
  盒: 250,
  瓶: 300,
  袋: 100,
  串: 80,
  根: 50,
  条: 100,
  勺: 15,
  ml: 1,
  毫升: 1,
  g: 1,
  克: 1,
};

const PORTION_PROFILES: PortionProfile[] = [
  {
    keywords: /包子|肉包|菜包|小笼包/i,
    defaultGrams: 110,
    units: {个: 110, 只: 110},
  },
  {
    keywords: /豆浆/i,
    defaultGrams: 250,
    units: {杯: 250, 碗: 250, 盒: 250, 瓶: 300, ml: 1, 毫升: 1},
  },
  {
    keywords: /米饭|炒饭|盖饭/i,
    defaultGrams: 180,
    units: {碗: 180, 份: 200},
  },
  {
    keywords: /鸡蛋/i,
    defaultGrams: 50,
    units: {个: 50, 只: 50, 颗: 50},
  },
  {
    keywords: /馒头/i,
    defaultGrams: 100,
    units: {个: 100, 只: 100},
  },
  {
    keywords: /面条|汤面|拌面|拉面|粉/i,
    defaultGrams: 320,
    units: {碗: 320, 份: 320},
  },
  {
    keywords: /粥/i,
    defaultGrams: 250,
    units: {碗: 250, 杯: 250},
  },
  {
    keywords: /酸奶|牛奶/i,
    defaultGrams: 250,
    units: {杯: 250, 盒: 250, 瓶: 250, ml: 1, 毫升: 1},
  },
  {
    keywords: /鸡胸肉|牛排|鱼排/i,
    defaultGrams: 150,
    units: {块: 150, 片: 100, 份: 150},
  },
  {
    keywords: /宫保鸡丁|番茄炒蛋|炒鸡蛋|红烧肉|回锅肉/i,
    defaultGrams: 220,
    units: {份: 220, 盘: 220},
  },
];

function normalizeText(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .replace(/[。！？!?]/g, '')
    .trim();
}

function stripContext(description: string): string {
  let text = normalizeText(description);
  const replacements = [
    /^(今天早上|今天中午|今天晚上|今天早餐|今天午餐|今天晚餐|今早|昨晚|昨天早上|昨天中午|昨天晚上|早上|中午|晚上|早餐|午餐|晚餐|夜宵|宵夜|今天|昨天)\s*/i,
    /^(我今天|我刚刚|我刚才|我)\s*/i,
    /^(吃了|喝了|吃|喝|来了一份|来了份|来了一杯|来了一碗|来了个|点了|整了|记录(?:一下)?|摄入了|摄入)\s*/i,
  ];

  let changed = true;
  while (changed) {
    changed = false;
    for (const pattern of replacements) {
      const nextText = text.replace(pattern, '').trim();
      if (nextText !== text) {
        text = nextText;
        changed = true;
      }
    }
  }

  return text.replace(/^(大概|大约|差不多|约)\s*/i, '').trim();
}

function countQuantityPhrases(description: string): number {
  return [...normalizeText(description).matchAll(QUANTITY_PATTERN)].length;
}

function parseChineseNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed === '半') {
    return 0.5;
  }

  const numeric = Number.parseFloat(trimmed);
  if (Number.isFinite(numeric)) {
    return numeric;
  }

  const digitMap: Record<string, number> = {
    零: 0,
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  };

  if (trimmed === '十') {
    return 10;
  }

  if (trimmed.includes('十')) {
    const [tens, ones] = trimmed.split('十');
    const tensValue = tens ? digitMap[tens] ?? 0 : 1;
    const onesValue = ones ? digitMap[ones] ?? 0 : 0;
    return tensValue * 10 + onesValue;
  }

  if (trimmed.length === 1 && trimmed in digitMap) {
    return digitMap[trimmed];
  }

  return null;
}

function parseQuantity(quantityDescription: string) {
  const match = quantityDescription.match(
    /(\d+(?:\.\d+)?|半|两|[零一二三四五六七八九十百]+)\s*(个|只|颗|块|片|杯|碗|份|盘|盒|瓶|袋|串|根|条|勺|ml|毫升|g|克)?/i
  );

  if (!match) {
    return {count: 1, unit: null as string | null};
  }

  return {
    count: parseChineseNumber(match[1] ?? '') ?? 1,
    unit: match[2] ?? null,
  };
}

function getPortionProfile(foodName: string): PortionProfile | null {
  return PORTION_PROFILES.find((profile) => profile.keywords.test(foodName)) ?? null;
}

function estimateGrams(foodName: string, quantityDescription: string): number {
  if (!quantityDescription || quantityDescription === '未知') {
    return getPortionProfile(foodName)?.defaultGrams ?? 100;
  }

  const {count, unit} = parseQuantity(quantityDescription);
  const safeCount = Number.isFinite(count) && count > 0 ? count : 1;
  const profile = getPortionProfile(foodName);

  if (unit && (unit === 'g' || unit === '克' || unit === 'ml' || unit === '毫升')) {
    return Math.max(1, Math.round(safeCount));
  }

  const portionGrams =
    (unit ? profile?.units?.[unit] : undefined) ??
    (unit ? GENERIC_UNIT_GRAMS[unit] : undefined) ??
    profile?.defaultGrams ??
    100;

  return Math.max(1, Math.round(safeCount * portionGrams));
}

function extractSingleFoodCandidate(description: string) {
  const stripped = stripContext(description);

  if (!stripped || stripped.length > DIRECT_PARSE_MAX_LENGTH) {
    return null;
  }

  if (MULTI_ITEM_SEPARATOR.test(stripped) || countQuantityPhrases(stripped) > 1) {
    return null;
  }

  const prefixMatch = stripped.match(PREFIX_QUANTITY_PATTERN);
  if (prefixMatch) {
    return {
      foodName: prefixMatch[2]?.trim() ?? '',
      quantityDescription: prefixMatch[1]?.trim() ?? '未知',
    };
  }

  const suffixMatch = stripped.match(SUFFIX_QUANTITY_PATTERN);
  if (suffixMatch) {
    return {
      foodName: suffixMatch[1]?.trim() ?? '',
      quantityDescription: suffixMatch[2]?.trim() ?? '未知',
    };
  }

  return {
    foodName: stripped.trim(),
    quantityDescription: '未知',
  };
}

function extractMultiFoodCandidates(description: string) {
  const stripped = stripContext(description);

  if (!stripped || stripped.length > DIRECT_PARSE_MAX_LENGTH || MULTI_ITEM_SEPARATOR.test(stripped)) {
    return null;
  }

  if (countQuantityPhrases(stripped) < 2) {
    return null;
  }

  const matches = [...stripped.matchAll(MULTI_SEGMENT_PATTERN)];
  if (matches.length < 2) {
    return null;
  }

  const reconstructed = matches.map((match) => `${match[1] ?? ''}${match[2] ?? ''}`).join('').trim();
  if (reconstructed !== stripped) {
    return null;
  }

  return matches
    .map((match) => ({
      quantityDescription: match[1]?.trim() ?? '未知',
      foodName: sanitizeFoodName(match[2] ?? ''),
    }))
    .filter((candidate) => candidate.foodName);
}

function sanitizeFoodName(foodName: string): string {
  return foodName
    .replace(/^[的了又还和与及、，,\s]+/g, '')
    .replace(/^(一份|一碗|一杯|一个|一只|一颗|一块|一片)\s*/i, '')
    .replace(/\s+/g, '')
    .replace(/左右$/i, '')
    .trim();
}

function shouldAllowFuzzyMatch(foodName: string): boolean {
  return !COMPOSITE_FOOD_PATTERN.test(foodName);
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

export async function tryResolveDirectDescription(
  description: string
): Promise<ParseFoodDescriptionOutput | null> {
  const multiCandidates = extractMultiFoodCandidates(description);
  if (multiCandidates?.length) {
    const resolvedFoods: ParseFoodDescriptionOutput = [];

    for (const candidate of multiCandidates) {
      const exactMatch = await lookupNutritionByNameExact(candidate.foodName);
      const fuzzyCandidate =
        exactMatch || !shouldAllowFuzzyMatch(candidate.foodName)
          ? null
          : await lookupNutritionByNameFuzzy(candidate.foodName);
      const fuzzyMatch =
        fuzzyCandidate &&
        isSafeFuzzyMatch(candidate.foodName, fuzzyCandidate.matchedName)
          ? fuzzyCandidate
          : null;
      const dbMatch = exactMatch ?? fuzzyMatch;
      if (!dbMatch) {
        return null;
      }

      const estimatedGrams = estimateGrams(
        candidate.foodName,
        candidate.quantityDescription
      );

      resolvedFoods.push({
        foodName: candidate.foodName,
        quantityDescription: candidate.quantityDescription,
        estimatedGrams,
        confidence: 0.9,
        sourceKind: dbMatch.sourceKind,
        sourceLabel: dbMatch.sourceLabel,
        per100g: dbMatch.per100g,
        totals: scaleMacros(dbMatch.per100g, estimatedGrams),
      });
    }

    return resolvedFoods;
  }

  const candidate = extractSingleFoodCandidate(description);
  if (!candidate) {
    return null;
  }

  const foodName = sanitizeFoodName(candidate.foodName);
  if (!foodName) {
    return null;
  }

  const exactMatch = await lookupNutritionByNameExact(foodName);
  const fuzzyCandidate =
    exactMatch || !shouldAllowFuzzyMatch(foodName)
      ? null
      : await lookupNutritionByNameFuzzy(foodName);
  const fuzzyMatch =
    fuzzyCandidate && isSafeFuzzyMatch(foodName, fuzzyCandidate.matchedName)
      ? fuzzyCandidate
      : null;
  const dbMatch = exactMatch ?? fuzzyMatch;
  if (!dbMatch) {
    return null;
  }

  const estimatedGrams = estimateGrams(foodName, candidate.quantityDescription);

  return [
    {
      foodName,
      quantityDescription: candidate.quantityDescription,
      estimatedGrams,
      confidence: candidate.quantityDescription === '未知' ? 0.84 : 0.96,
      sourceKind: dbMatch.sourceKind,
      sourceLabel: dbMatch.sourceLabel,
      per100g: dbMatch.per100g,
      totals: scaleMacros(dbMatch.per100g, estimatedGrams),
    },
  ];
}
