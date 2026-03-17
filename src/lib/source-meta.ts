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

export function getReliabilityMeta(
  item: Pick<
    ResolvedFoodItem,
    'sourceKind' | 'matchMode' | 'confidence' | 'validationFlags'
  >
): {
  label: string;
  badgeClass: string;
  hintClass: string;
  description: string;
} {
  if (
    item.sourceKind !== 'ai_fallback' &&
    item.validationFlags.includes('nutrition_partial')
  ) {
    return {
      label: '数据库部分缺失',
      badgeClass: 'border-amber-200 bg-amber-50 text-amber-800',
      hintClass: 'border-amber-200 bg-amber-50 text-amber-900',
      description:
        item.validationFlags.includes('db_micronutrient_ai_merged')
          ? '数据库提供了宏量与已知营养，缺失项已用 AI 保守补齐，并会在详情中单独标记。'
          : '数据库命中了这项食物，但部分微量营养素缺失，缺失项不会再被静默显示成 0。',
    };
  }

  if (item.sourceKind !== 'ai_fallback' && item.matchMode === 'exact') {
    return {
      label: '数据库高可信',
      badgeClass: 'border-emerald-200 bg-emerald-50 text-emerald-700',
      hintClass: 'border-emerald-200 bg-emerald-50 text-emerald-800',
      description: '已直接命中标准食谱或标准营养库，营养和微量数据可信度最高。',
    };
  }

  if (item.sourceKind !== 'ai_fallback') {
    return {
      label: '数据库相似匹配',
      badgeClass: 'border-sky-200 bg-sky-50 text-sky-700',
      hintClass: 'border-sky-200 bg-sky-50 text-sky-800',
      description: '结果来自数据库相似匹配，通常可靠，但仍建议核对食物名称是否贴合。',
    };
  }

  const needsExtraReview =
    item.validationFlags.includes('ai_macro_unverified') ||
    item.validationFlags.includes('ai_macro_clamped') ||
    item.confidence < 0.5;

  return needsExtraReview
    ? {
        label: 'AI 估算需重点复核',
        badgeClass: 'border-amber-300 bg-amber-50 text-amber-800',
        hintClass: 'border-amber-200 bg-amber-50 text-amber-900',
        description:
          '这项依赖 AI 估算且已触发保守修正或校验告警，重量与微量营养素都建议优先人工确认。',
      }
    : {
        label: 'AI 估算需复核',
        badgeClass: 'border-slate-300 bg-slate-50 text-slate-700',
        hintClass: 'border-slate-300 bg-slate-50 text-slate-800',
        description:
          '这项依赖 AI 兜底估算。宏量通常可作参考，但钾、锌和维生素类微量营养素误差可能更大。',
      };
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
    case 'portion_fallback_applied':
      return '已应用回退份量基线';
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
    case 'db_micronutrient_gap':
      return '数据库缺少部分微量营养素';
    case 'db_micronutrient_ai_merged':
      return '缺失营养已用 AI 保守补齐';
    case 'nutrition_partial':
      return '该记录含部分缺失营养值';
    case 'nutrition_unknown':
      return '存在未知营养值';
    default:
      return flag;
  }
}
