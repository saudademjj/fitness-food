export const DIRECT_PARSE_MAX_LENGTH = 64;
export const MULTI_ITEM_SEPARATOR = /[，,、；;\/]/;
export const COMPOSITE_FOOD_PATTERN =
  /(炒饭|蛋炒饭|盖饭|拌饭|焖饭|烩饭|煲仔饭|焗饭|炒面|拌面|汤面|拉面|米线|河粉|炒粉|意面|三明治|汉堡|披萨|卷饼|沙拉|套餐|便当|拼盘|火锅|麻辣烫|冒菜|砂锅|小炒|炒菜|盖浇|咖喱饭|寿司|饭团|肉丝|肉片|肉末|蛋花汤|排骨汤|丸子汤)/i;
export const UNSAFE_FUZZY_MATCH_PATTERN =
  /(婴儿|婴幼儿|快餐|三明治|卷饼|汤|罐装|填料|调味|混合|饼干|松饼|百吉饼|潜艇|咖喱|餐厅|冷冻|晚餐|早餐|幼儿|泥|面包|汉堡)/i;
export const DANGEROUS_SUFFIX_PATTERN =
  /(醋|填料|浇头|布丁|卷|调味|调味料|调味粉|调味酱|婴儿食品|泥|果汁|饮料|奶昔|蘸料|酱|派)$/i;
const COOKING_COMPOSITE_PATTERN =
  /[\u4e00-\u9fffA-Za-z]{1,8}(炒|烧|煮|蒸|炖|焖|烤|炸|拌|煲|烩)[\u4e00-\u9fffA-Za-z]{1,8}/u;
const NON_FOOD_COMPOSITE_PATTERN =
  /(炒勺|炒锅|炒作|烧杯|烧瓶|煮锅|蒸箱|烤箱|炸锅|拌匀|炖锅|焖锅|煲锅|电饭煲)/i;

const QUANTITY_PATTERN =
  /(?:约|大约|差不多|大概)?\s*(?:\d+(?:\.\d+)?|半|两|[零一二三四五六七八九十百]+)\s*(?:个|只|颗|块|片|杯|碗|份|盘|盒|瓶|袋|包|串|根|条|勺|罐|ml|毫升|g|克)/g;
const PREFIX_QUANTITY_PATTERN =
  /^((?:约|大约|差不多|大概)?\s*(?:\d+(?:\.\d+)?|半|两|[零一二三四五六七八九十百]+)\s*(?:个|只|颗|块|片|杯|碗|份|盘|盒|瓶|袋|包|串|根|条|勺|罐|ml|毫升|g|克))\s*(.+)$/i;
const SUFFIX_QUANTITY_PATTERN =
  /^(.+?)\s*((?:\d+(?:\.\d+)?|半|两|[零一二三四五六七八九十百]+)\s*(?:g|克|ml|毫升))$/i;
const CONNECTOR_PATTERN = /(和|以及|还有|外加|配上|搭配|配|跟)/g;
const CONNECTOR_RIGHT_QUANTITY_PATTERN =
  /^\s*(?:约|大约|差不多|大概)?\s*(?:\d+(?:\.\d+)?|半|两|[零一二三四五六七八九十百]+)\s*(?:个|只|颗|块|片|杯|碗|份|盘|盒|瓶|袋|包|串|根|条|勺|罐|ml|毫升|g|克)/i;
const ANY_QUANTITY_PATTERN =
  /(?:约|大约|差不多|大概)?\s*(?:\d+(?:\.\d+)?|半|两|[零一二三四五六七八九十百]+)\s*(?:个|只|颗|块|片|杯|碗|份|盘|盒|瓶|袋|包|串|根|条|勺|罐|ml|毫升|g|克)/i;
const INTRINSIC_CONNECTOR_DISH_PATTERN = /(汤|羹|煲)$/;

function shouldSplitConnector(
  connector: string,
  leftContext: string,
  rightContext: string
): boolean {
  const normalizedLeft = leftContext.trim();
  const normalizedRight = rightContext.trim();
  if (!normalizedLeft || !normalizedRight) {
    return false;
  }

  if (CONNECTOR_RIGHT_QUANTITY_PATTERN.test(normalizedRight)) {
    return true;
  }

  if (/(以及|还有|外加|配上|搭配|配)/.test(connector)) {
    return ANY_QUANTITY_PATTERN.test(normalizedRight);
  }

  if (
    /(和|跟)/.test(connector) &&
    !INTRINSIC_CONNECTOR_DISH_PATTERN.test(normalizedLeft) &&
    !INTRINSIC_CONNECTOR_DISH_PATTERN.test(normalizedRight) &&
    !isCompositeFoodName(normalizedLeft) &&
    !isCompositeFoodName(normalizedRight) &&
    normalizedLeft.length <= 8 &&
    normalizedRight.length <= 8
  ) {
    return true;
  }

  return false;
}

export type ExtractedFoodCandidate = {
  foodName: string;
  quantityDescription: string;
};

export function normalizeText(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .replace(/[。！？!?]/g, '')
    .trim();
}

export function normalizeLookupText(value: string): string {
  return normalizeText(value).toLowerCase().replace(/\s+/g, '');
}

export function normalizeItemSeparators(value: string): string {
  const normalized = normalizeText(value).replace(
    CONNECTOR_PATTERN,
    (connector, _group, offset, source) => {
      const leftContext = source.slice(0, offset);
      const rightContext = source.slice(offset + connector.length);
      return shouldSplitConnector(connector, leftContext, rightContext) ? '、' : connector;
    }
  );

  return normalized
    .replace(/[，,；;\/]+/g, '、')
    .replace(/、+/g, '、')
    .replace(/^、|、$/g, '')
    .trim();
}

export function stripContext(description: string): string {
  let text = normalizeText(description);
  const replacements = [
    /^(今天早上|今天上午|今天中午|今天下午|今天晚上|今天早餐|今天午餐|今天晚餐|今早|今晚|昨晚|昨天早上|昨天中午|昨天晚上|前天|上周|去年|早上|中午|晚上|早餐|午餐|晚餐|夜宵|宵夜|今天|昨天)\s*/i,
    /^(我今天|我刚刚|我刚才|我刚|我)\s*/i,
    /^(吃了|喝了|吃|喝|来了一份|来了份|来了一杯|来了一碗|来了个|点了|整了|记录(?:一下)?|摄入了|摄入|大概吃了|大约吃了|估摸着吃了|估计吃了)\s*/i,
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

  return text
    .replace(/^(大概|大约|差不多|约|估摸着|估计|差不多有|大概有|大约有)\s*/i, '')
    .replace(/(大概|大约|差不多|约|估摸着|估计)/gi, '')
    .replace(/左右的?/gi, '')
    .replace(/多(?:一点|一些)?$/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function countQuantityPhrases(description: string): number {
  return [...normalizeText(description).matchAll(QUANTITY_PATTERN)].length;
}

export function parseChineseNumber(value: string): number | null {
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

export function parseQuantity(quantityDescription: string) {
  const match = quantityDescription.match(
    /(\d+(?:\.\d+)?|半|两|[零一二三四五六七八九十百]+)\s*(个|只|颗|块|片|杯|碗|份|盘|盒|瓶|袋|包|串|根|条|勺|罐|ml|毫升|g|克)?/i
  );

  if (!match) {
    return {count: 1, unit: null as string | null};
  }

  return {
    count: parseChineseNumber(match[1] ?? '') ?? 1,
    unit: match[2] ?? null,
  };
}

export function sanitizeFoodName(foodName: string): string {
  return foodName
    .replace(/^[的了又还与及、，,\s]+/g, '')
    .replace(/^(一份|一碗|一杯|一个|一只|一颗|一块|一片)\s*/i, '')
    .replace(/\s+/g, '')
    .replace(/左右$/i, '')
    .trim();
}

export function isCompositeFoodName(foodName: string): boolean {
  const normalizedFoodName = sanitizeFoodName(normalizeText(foodName));
  if (!normalizedFoodName) {
    return false;
  }

  if (NON_FOOD_COMPOSITE_PATTERN.test(normalizedFoodName)) {
    return false;
  }

  return (
    COMPOSITE_FOOD_PATTERN.test(normalizedFoodName) ||
    COOKING_COMPOSITE_PATTERN.test(normalizedFoodName)
  );
}

export function extractSingleFoodCandidate(description: string): ExtractedFoodCandidate | null {
  const stripped = stripContext(description);

  if (!stripped || stripped.length > DIRECT_PARSE_MAX_LENGTH) {
    return null;
  }

  if (MULTI_ITEM_SEPARATOR.test(normalizeItemSeparators(stripped)) || countQuantityPhrases(stripped) > 1) {
    return null;
  }

  const prefixMatch = stripped.match(PREFIX_QUANTITY_PATTERN);
  if (prefixMatch) {
    return {
      foodName: sanitizeFoodName(prefixMatch[2] ?? ''),
      quantityDescription: prefixMatch[1]?.trim() ?? '未知',
    };
  }

  const suffixMatch = stripped.match(SUFFIX_QUANTITY_PATTERN);
  if (suffixMatch) {
    return {
      foodName: sanitizeFoodName(suffixMatch[1] ?? ''),
      quantityDescription: suffixMatch[2]?.trim() ?? '未知',
    };
  }

  return {
    foodName: sanitizeFoodName(stripped.trim()),
    quantityDescription: '未知',
  };
}

export function extractWholeDishCandidate(
  description: string
): ExtractedFoodCandidate | null {
  const stripped = stripContext(description);
  if (!stripped) {
    return null;
  }

  const prefixMatch = stripped.match(PREFIX_QUANTITY_PATTERN);
  if (prefixMatch) {
    const foodName = sanitizeFoodName(prefixMatch[2] ?? '');
    return isCompositeFoodName(foodName)
      ? {
          foodName,
          quantityDescription: prefixMatch[1]?.trim() ?? '未知',
        }
      : null;
  }

  const suffixMatch = stripped.match(SUFFIX_QUANTITY_PATTERN);
  if (suffixMatch) {
    const foodName = sanitizeFoodName(suffixMatch[1] ?? '');
    return isCompositeFoodName(foodName)
      ? {
          foodName,
          quantityDescription: suffixMatch[2]?.trim() ?? '未知',
        }
      : null;
  }

  const foodName = sanitizeFoodName(stripped.trim());
  return isCompositeFoodName(foodName)
    ? {
        foodName,
        quantityDescription: '未知',
      }
    : null;
}

export function splitFoodDescriptionSegments(description: string): string[] {
  const stripped = stripContext(description);
  if (!stripped) {
    return [];
  }

  return normalizeItemSeparators(stripped)
    .split('、')
    .map((segment) => segment.trim())
    .filter(Boolean);
}

export function extractMultiFoodCandidates(
  description: string
): ExtractedFoodCandidate[] | null {
  const stripped = normalizeItemSeparators(stripContext(description));

  if (!stripped || stripped.length > DIRECT_PARSE_MAX_LENGTH) {
    return null;
  }

  const segments = stripped
    .split('、')
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (segments.length < 2) {
    return null;
  }

  const candidates = segments
    .map((segment) => extractSingleFoodCandidate(segment))
    .filter((candidate): candidate is ExtractedFoodCandidate => Boolean(candidate?.foodName));

  return candidates.length >= 2 ? candidates : null;
}
