import type {ResolvedFoodItems} from '@/lib/food-contract';

export const SECONDARY_REVIEW_SYSTEM_PROMPT = `
你是饮食记录结果复核助手。
你的任务不是重新拆解用户输入，而是基于用户原始描述、数据库参考和首轮解析结果，对每个条目的最终食物名、重量与每100g营养进行交叉复核。

核心原则：
1. 必须严格保持输入条目的数量、顺序与 foodName 一一对应，不能新增、删除、合并、拆分条目。
2. 如果某个条目 weightLocked=true，则 estimatedGrams 必须与输入完全一致，不能修改。
3. 数据库已测量的字段应视作高价值参考；你可以在 reason 中说明，但不要试图推翻这些已测量字段。
4. 对 AI 兜底条目，你可以重新评估 estimatedGrams 与 reviewedPer100g。
5. reviewedPer100g 必须是该条目的最终每100g建议营养，不是当前这次摄入 totals。
6. 对 19 项微量营养没有把握时返回 null，不要为了凑字段编造。
7. reason 只写一句简短中文，说明你为何调整或维持原结果。

输出要求：
- 只返回 JSON 数组，不要解释，不要 Markdown。
- 每个元素都必须保留原 index 和 foodName。
- estimatedGrams 必须是这次摄入的总重量。
- confidence 用 0 到 1 表示你对这次复核结果的把握。
- reviewedPer100g 必须包含完整 23 项字段。
`;

const NULLABLE_NON_NEGATIVE_SCHEMA = {
  anyOf: [
    {type: 'number', minimum: 0},
    {type: 'null'},
  ],
} as const;

export const SECONDARY_REVIEW_RESPONSE_JSON_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      index: {
        type: 'integer',
        minimum: 0,
      },
      foodName: {
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
      reason: {
        type: 'string',
      },
      reviewedPer100g: {
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
      'index',
      'foodName',
      'estimatedGrams',
      'confidence',
      'reason',
      'reviewedPer100g',
    ],
    additionalProperties: false,
  },
};

export function buildSecondaryReviewPrompt(
  sourceDescription: string,
  foods: ResolvedFoodItems,
  weightLocks: boolean[]
): string {
  return [
    '请复核以下饮食记录结果，并输出约定的 JSON 数组。',
    `原始描述：${sourceDescription}`,
    '',
    '当前条目 JSON：',
    JSON.stringify(
      foods.map((food, index) => ({
        index,
        foodName: food.foodName,
        quantityDescription: food.quantityDescription,
        estimatedGrams: food.estimatedGrams,
        confidence: food.confidence,
        sourceKind: food.sourceKind,
        matchMode: food.matchMode,
        sourceLabel: food.sourceLabel,
        validationFlags: food.validationFlags,
        per100g: food.per100g,
        per100gMeta: food.per100gMeta,
        weightLocked: weightLocks[index] ?? false,
      })),
      null,
      2
    ),
  ].join('\n');
}
