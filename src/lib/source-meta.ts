import type {ResolvedFoodItem} from '@/lib/food-contract';

export function getSourceKindLabel(sourceKind: ResolvedFoodItem['sourceKind']): string {
  if (sourceKind === 'recipe') {
    return '标准食谱';
  }
  if (sourceKind === 'catalog') {
    return '标准营养库';
  }
  return 'AI 估算';
}

export function getMatchModeLabel(matchMode: ResolvedFoodItem['matchMode']): string {
  if (matchMode === 'exact') {
    return '精确匹配';
  }
  if (matchMode === 'fuzzy') {
    return '相似匹配';
  }
  return 'AI兜底';
}

export function formatValidationFlag(flag: ResolvedFoodItem['validationFlags'][number]): string {
  switch (flag) {
    case 'ai_macro_estimate':
      return '营养值来自 AI 估算';
    case 'ai_macro_clamped':
      return 'AI 营养值已保守修正';
    case 'db_lookup_miss':
      return '数据库未命中';
    case 'portion_reference_applied':
      return '已应用标准份量';
    case 'portion_keyword_applied':
      return '已应用关键词份量';
    case 'portion_size_adjusted':
      return '已按大小修饰词调整份量';
    case 'portion_preparation_adjusted':
      return '已按烹饪方式调整份量和营养';
    case 'composite_total_rebalanced':
      return '已按总克重重平衡';
    case 'whole_dish_db_override':
      return '整道菜 DB 结果已覆盖拆解估算';
    case 'whole_dish_component_aligned':
      return '拆解项已对齐整道菜 DB 总量';
    case 'low_confidence':
      return '置信度较低，建议人工确认';
    case 'ai_macro_unverified':
      return 'AI 营养值未通过校验';
    default:
      return flag;
  }
}
