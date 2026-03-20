import {createNutritionProfile, type NutritionProfile23} from '@/lib/nutrition-profile';

export const ESTIMATION_SYSTEM_PROMPT = `
你是中文饮食记录助手。
只在本地营养数据库无法直接命中整句描述时，帮后端把用户的一句话饮食描述拆成最终可查库的食物条目。

目标：
1. 尽量输出容易命中数据库的通用中文食物名或菜名。
2. 单一食品、品牌食品、完整成品如果本身就是独立食物，例如"麦旋风""可乐""纯牛奶""肉包子"，可直接作为一个条目返回。
3. 如果用户描述的是一道完整的菜（例如"辣椒炒肉"、"番茄炒蛋"、"宫保鸡丁"、"红烧排骨"、"清蒸鲈鱼"、"麻婆豆腐"），作为单个条目返回这道菜的整体名称，不要拆解成原料。
4. 只有当描述涉及多种独立食物的组合餐、套餐、便当时（例如"一碗米饭加一个鸡腿和一碗汤"），才拆解成各自独立的条目。
5. 估算每个条目这次实际吃下的总克重。
6. 额外给出每100g 的 23 项营养兜底字段，但只有宏量营养必须给出；微量营养没有把握时必须返回 null，不能猜。

要求：
- 只返回 JSON 数组，不要解释，不要 Markdown。
- estimatedGrams 必须是每个条目这次总摄入重量，不是单个重量。
- quantityDescription 保留关键量词；没有明确数量时写"未知"。
- 看到"一个 / 一碗 / 一杯 / 一份 / 一盘 / 一片"时，estimatedGrams 必须参考常见成品份量：
  一个鸡蛋约 50g；一碗熟米饭约 180g；一杯豆浆约 300g；一份炒饭/盖饭约 300-400g；
  一碗汤面约 350-500g；一片披萨约 100-150g；一份蛋糕约 80-120g。
- 没有明确重量依据时，不要把"一碗面"估成 200g 或 500g 这种极端值；拿不准就给中间常见值，并降低 confidence。
- fallbackPer100g 必须包含以下 23 项字段：
  energyKcal、proteinGrams、carbohydrateGrams、fatGrams、
  fiberGrams、sugarsGrams、
  sodiumMg、potassiumMg、calciumMg、magnesiumMg、ironMg、zincMg、
  vitaminAMcg、vitaminCMg、vitaminDMcg、vitaminEMg、vitaminKMcg、
  thiaminMg、riboflavinMg、niacinMg、vitaminB6Mg、vitaminB12Mcg、folateMcg。
- 对 19 项微量营养素没有把握时，直接返回 null；不要为了凑字段而猜值。
- 对植物性蔬菜、水果、米饭、面、面包等食物，vitaminB12 和 vitaminD 没有可靠证据时返回 null，不要给出显著数值。
- 一句话里提到多种独立食物时才拆成多个元素，例如"两个包子和一杯豆浆"拆为包子和豆浆两个条目。
- 单道菜名如"辣椒炒肉"、"番茄烧牛腩"、"鱼香肉丝"直接作为一个完整条目返回，不要拆解成原料。
- 像"火腿蛋炒饭"这类食物名，直接作为一个条目"火腿蛋炒饭"返回即可，不要拆成米饭+鸡蛋+火腿。
- 如果用户提供了总克重，例如"400g火腿蛋炒饭"，直接使用该克重，不需要拆解。
- 对品牌名、口语化描述做适度归一，例如"小肉包"可归一为"鲜肉包子"。
- 对品牌食品、包装食品、连锁餐饮、新品或季节限定口味，如有必要可联网核对净含量、规格、份量或公开营养信息。
- 联网结果若互相矛盾，优先采用更保守、更常见的份量；没有可靠信息时不要编造，直接降低 confidence。
`;

export const COMPOSITE_DISH_SYSTEM_PROMPT = `
你是中文饮食记录助手，当前任务是把单道复合菜拆成可查库原料。

目标：
1. 输入一定是一道单独的成品菜、复合主食、带馅主食或快餐单品，例如"辣椒炒肉""番茄炒蛋""宫保鸡丁""火腿蛋炒饭""香菇猪肉水饺""猪肉包子""巨无霸汉堡""薯条"。
2. 输出最常见、最容易命中营养数据库的原料名，不要输出调味步骤、品牌名或口语化废话。
3. 给出每个原料在这道菜中的实际克重，所有原料 estimatedGrams 之和必须接近整道菜总重量。
4. 对影响热量或钠含量明显的原料，要包含食用油、盐、酱油等基础调味项。
5. 每个原料只返回宏量营养兜底：energyKcal、proteinGrams、carbohydrateGrams、fatGrams。
6. dishName 必须是原菜名或更标准的同义菜名；totalEstimatedGrams 必须是整道菜总重量。

要求：
- 只返回 JSON 对象，不要解释，不要 Markdown。
- ingredients 里的 ingredientName 必须是单个原料，不要再写"辣椒炒肉"这种整菜。
- estimatedGrams 必须是该原料在这道菜里的总克重，不是每100g。
- confidence 用 0 到 1 表示你对该原料名和克重的把握。
- fallbackPer100g 只包含宏量营养 4 项；拿不准时给保守中位值，不要输出极端值。
- 如果用户给了明确总重量，例如"400g辣椒炒肉"，totalEstimatedGrams 应尽量贴近该重量，ingredients 总克重也要贴近。
- 水饺、包子、馄饨、锅贴、烧卖这类带馅主食，要同时考虑外皮/面皮与主要馅料；汉堡要考虑面包、肉饼、奶酪/酱料；薯条至少要考虑土豆、食用油、盐。
- 如果是炒菜，通常会包含少量油；如果是带汁菜，可以包含少量盐或酱油；但不要无意义地堆很多调料。
- 对连锁餐饮或明显带品牌的成品菜，必要时可联网参考公开配料、份量或营养信息，但不要直接照搬营销文案。
`;

const NULLABLE_NON_NEGATIVE_SCHEMA = {
  anyOf: [
    {type: 'number', minimum: 0},
    {type: 'null'},
  ],
} as const;

export const ESTIMATION_RESPONSE_JSON_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      foodName: {
        type: 'string',
        description: '通用中文食物名或菜名，优先选择容易查营养库的写法。',
      },
      quantityDescription: {
        type: 'string',
        description: '原句中的数量描述；没有明确数量时写"未知"。',
      },
      estimatedGrams: {
        type: 'number',
        description: '本次实际摄入的总克重。',
        minimum: 1,
      },
      confidence: {
        type: 'number',
        description: '0 到 1 之间的小数，表示你对名称和克重判断的信心。',
        minimum: 0,
        maximum: 1,
      },
      fallbackPer100g: {
        type: 'object',
        properties: {
          energyKcal: NULLABLE_NON_NEGATIVE_SCHEMA,
          proteinGrams: NULLABLE_NON_NEGATIVE_SCHEMA,
          carbohydrateGrams: NULLABLE_NON_NEGATIVE_SCHEMA,
          fatGrams: NULLABLE_NON_NEGATIVE_SCHEMA,
          fiberGrams: NULLABLE_NON_NEGATIVE_SCHEMA,
          sugarsGrams: NULLABLE_NON_NEGATIVE_SCHEMA,
          sodiumMg: NULLABLE_NON_NEGATIVE_SCHEMA,
          potassiumMg: NULLABLE_NON_NEGATIVE_SCHEMA,
          calciumMg: NULLABLE_NON_NEGATIVE_SCHEMA,
          magnesiumMg: NULLABLE_NON_NEGATIVE_SCHEMA,
          ironMg: NULLABLE_NON_NEGATIVE_SCHEMA,
          zincMg: NULLABLE_NON_NEGATIVE_SCHEMA,
          vitaminAMcg: NULLABLE_NON_NEGATIVE_SCHEMA,
          vitaminCMg: NULLABLE_NON_NEGATIVE_SCHEMA,
          vitaminDMcg: NULLABLE_NON_NEGATIVE_SCHEMA,
          vitaminEMg: NULLABLE_NON_NEGATIVE_SCHEMA,
          vitaminKMcg: NULLABLE_NON_NEGATIVE_SCHEMA,
          thiaminMg: NULLABLE_NON_NEGATIVE_SCHEMA,
          riboflavinMg: NULLABLE_NON_NEGATIVE_SCHEMA,
          niacinMg: NULLABLE_NON_NEGATIVE_SCHEMA,
          vitaminB6Mg: NULLABLE_NON_NEGATIVE_SCHEMA,
          vitaminB12Mcg: NULLABLE_NON_NEGATIVE_SCHEMA,
          folateMcg: NULLABLE_NON_NEGATIVE_SCHEMA,
        },
        required: [
          'energyKcal',
          'proteinGrams',
          'carbohydrateGrams',
          'fatGrams',
          'fiberGrams',
          'sugarsGrams',
          'sodiumMg',
          'potassiumMg',
          'calciumMg',
          'magnesiumMg',
          'ironMg',
          'zincMg',
          'vitaminAMcg',
          'vitaminCMg',
          'vitaminDMcg',
          'vitaminEMg',
          'vitaminKMcg',
          'thiaminMg',
          'riboflavinMg',
          'niacinMg',
          'vitaminB6Mg',
          'vitaminB12Mcg',
          'folateMcg',
        ],
        additionalProperties: false,
      },
    },
    required: [
      'foodName',
      'quantityDescription',
      'estimatedGrams',
      'confidence',
      'fallbackPer100g',
    ],
    additionalProperties: false,
  },
};

export const COMPOSITE_RESPONSE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    dishName: {
      type: 'string',
    },
    totalEstimatedGrams: {
      type: 'number',
      minimum: 1,
    },
    confidence: {
      type: 'number',
      minimum: 0,
      maximum: 1,
    },
    cookingMethod: {
      anyOf: [{type: 'string'}, {type: 'null'}],
    },
    ingredients: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        properties: {
          ingredientName: {
            type: 'string',
          },
          estimatedGrams: {
            type: 'number',
            minimum: 1,
          },
          confidence: {
            type: 'number',
            minimum: 0,
            maximum: 1,
          },
          optional: {
            type: 'boolean',
          },
          fallbackPer100g: {
            type: 'object',
            properties: {
              energyKcal: NULLABLE_NON_NEGATIVE_SCHEMA,
              proteinGrams: NULLABLE_NON_NEGATIVE_SCHEMA,
              carbohydrateGrams: NULLABLE_NON_NEGATIVE_SCHEMA,
              fatGrams: NULLABLE_NON_NEGATIVE_SCHEMA,
            },
            required: [
              'energyKcal',
              'proteinGrams',
              'carbohydrateGrams',
              'fatGrams',
            ],
            additionalProperties: false,
          },
        },
        required: [
          'ingredientName',
          'estimatedGrams',
          'confidence',
          'optional',
          'fallbackPer100g',
        ],
        additionalProperties: false,
      },
    },
  },
  required: ['dishName', 'totalEstimatedGrams', 'confidence', 'ingredients'],
  additionalProperties: false,
};

function normalizeNutritionNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number.parseFloat(value)
        : Number.NaN;

  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeNutritionProfilePayload(payload: unknown): NutritionProfile23 {
  const record = payload && typeof payload === 'object'
    ? (payload as Record<string, unknown>)
    : {};

  return createNutritionProfile({
    energyKcal: normalizeNutritionNumber(record.energyKcal ?? record.calories ?? record.energy),
    proteinGrams: normalizeNutritionNumber(record.proteinGrams ?? record.protein),
    carbohydrateGrams: normalizeNutritionNumber(
      record.carbohydrateGrams ?? record.carbohydrates ?? record.carbs
    ),
    fatGrams: normalizeNutritionNumber(record.fatGrams ?? record.fat),
    fiberGrams: normalizeNutritionNumber(record.fiberGrams ?? record.fiber),
    sugarsGrams: normalizeNutritionNumber(record.sugarsGrams ?? record.sugar ?? record.sugars),
    sodiumMg: normalizeNutritionNumber(record.sodiumMg ?? record.sodium),
    potassiumMg: normalizeNutritionNumber(record.potassiumMg ?? record.potassium),
    calciumMg: normalizeNutritionNumber(record.calciumMg ?? record.calcium),
    magnesiumMg: normalizeNutritionNumber(record.magnesiumMg ?? record.magnesium),
    ironMg: normalizeNutritionNumber(record.ironMg ?? record.iron),
    zincMg: normalizeNutritionNumber(record.zincMg ?? record.zinc),
    vitaminAMcg: normalizeNutritionNumber(record.vitaminAMcg ?? record.vitaminA),
    vitaminCMg: normalizeNutritionNumber(record.vitaminCMg ?? record.vitaminC),
    vitaminDMcg: normalizeNutritionNumber(record.vitaminDMcg ?? record.vitaminD),
    vitaminEMg: normalizeNutritionNumber(record.vitaminEMg ?? record.vitaminE),
    vitaminKMcg: normalizeNutritionNumber(record.vitaminKMcg ?? record.vitaminK),
    thiaminMg: normalizeNutritionNumber(record.thiaminMg ?? record.vitaminB1),
    riboflavinMg: normalizeNutritionNumber(record.riboflavinMg ?? record.vitaminB2),
    niacinMg: normalizeNutritionNumber(record.niacinMg ?? record.vitaminB3 ?? record.niacin),
    vitaminB6Mg: normalizeNutritionNumber(record.vitaminB6Mg ?? record.vitaminB6),
    vitaminB12Mcg: normalizeNutritionNumber(record.vitaminB12Mcg ?? record.vitaminB12),
    folateMcg: normalizeNutritionNumber(record.folateMcg ?? record.vitaminB9 ?? record.folate),
  });
}

export function normalizeParsedItemsPayload(payload: unknown): unknown {
  if (!Array.isArray(payload)) {
    return payload;
  }

  return payload.map((entry) => {
    if (!entry || typeof entry !== 'object') {
      return entry;
    }

    const record = entry as Record<string, unknown>;
    return {
      foodName: record.foodName ?? record.name ?? record.food,
      quantityDescription:
        record.quantityDescription ?? record.quantity ?? record.quantity_label ?? '未知',
      estimatedGrams: record.estimatedGrams ?? record.grams ?? record.weightGrams ?? record.weight,
      confidence: record.confidence,
      fallbackPer100g: normalizeNutritionProfilePayload(
        record.fallbackPer100g ?? record.per100g ?? record.per100 ?? record.nutritionPer100g
      ),
    };
  });
}

export function extractJsonPayload(text: string, providerLabel: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error(`${providerLabel} returned an empty JSON payload.`);
  }

  try {
    return JSON.parse(trimmed);
  } catch {}

  const fencedMatch =
    trimmed.match(/```json\s*([\s\S]*?)```/i) ??
    trimmed.match(/```\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    return JSON.parse(fencedMatch[1].trim());
  }

  const arrayStart = trimmed.indexOf('[');
  const arrayEnd = trimmed.lastIndexOf(']');
  if (arrayStart >= 0 && arrayEnd > arrayStart) {
    return JSON.parse(trimmed.slice(arrayStart, arrayEnd + 1));
  }

  throw new Error(`Unable to extract JSON from ${providerLabel} response.`);
}
