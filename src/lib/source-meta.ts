import type {FoodReviewMeta, ResolvedFoodItem} from '@/lib/food-contract';

export function getReviewerLabel(provider: string): string {
  switch (provider) {
    case 'primary_model':
    case 'openrouter':
    case 'dashscope':
      return '主模型';
    case 'minimax':
      return 'MiniMax';
    case 'deepseek':
      return 'DeepSeek';
    default:
      return provider;
  }
}

export function getReviewVerdictMeta(reviewMeta: FoodReviewMeta): {
  label: string;
  badgeClass: string;
  hintClass: string;
  description: string;
} {
  const providerText = reviewMeta.providers.length
    ? reviewMeta.providers.map(getReviewerLabel).join(' / ')
    : '复核模型';
  const successText = `${reviewMeta.successfulReviewerCount}/${reviewMeta.reviewerCount}`;
  const supportText = `${reviewMeta.voteCount}/${reviewMeta.reviewerCount}`;
  const scoreText = `${Math.round(reviewMeta.consensusScore * 100)} 分`;

  if (reviewMeta.verdict === 'failed') {
    const insufficientConsensus = reviewMeta.successfulReviewerCount > 0;
    return {
      label: insufficientConsensus ? '多模型未形成共识' : '多模型复核失败',
      badgeClass: 'border-amber-300 bg-amber-50 text-amber-800',
      hintClass: 'border-amber-200 bg-amber-50 text-amber-900',
      description: insufficientConsensus
        ? `${providerText} 本轮仅 ${successText} 返回，未达到最少双 reviewer 共识门槛，当前仍展示复核前结果，建议人工确认。`
        : `${providerText} 本轮仅 ${successText} 返回，未形成可用共识，当前仍展示复核前结果，建议人工确认。`,
    };
  }

  if (reviewMeta.verdict === 'high') {
    return {
      label: '三模型高一致',
      badgeClass: 'border-emerald-200 bg-emerald-50 text-emerald-700',
      hintClass: 'border-emerald-200 bg-emerald-50 text-emerald-800',
      description: `${providerText} 已返回 ${successText}，其中 ${supportText} 支持当前结果，共识分 ${scoreText}，可直接作为优先参考。`,
    };
  }

  if (reviewMeta.verdict === 'medium') {
    return {
      label: '三模型基本一致',
      badgeClass: 'border-sky-200 bg-sky-50 text-sky-700',
      hintClass: 'border-sky-200 bg-sky-50 text-sky-800',
      description: `${providerText} 已返回 ${successText}，其中 ${supportText} 支持当前结果，共识分 ${scoreText}，建议结合分量再看一眼。`,
    };
  }

  return {
    label: '三模型存在分歧',
    badgeClass: 'border-amber-300 bg-amber-50 text-amber-800',
    hintClass: 'border-amber-200 bg-amber-50 text-amber-900',
    description: `${providerText} 已返回 ${successText}，但只有 ${supportText} 支持当前结果，共识分 ${scoreText}，建议重点核对重量和食物名称。`,
  };
}

export function getSourceKindLabel(sourceKind: ResolvedFoodItem['sourceKind']): string {
  if (sourceKind === 'recipe') {
    return '标准食谱';
  }
  if (sourceKind === 'catalog') {
    return '标准营养库';
  }
  if (sourceKind === 'runtime_composite') {
    return '运行时整菜聚算';
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
  if (matchMode === 'runtime_ingredients') {
    return '原料聚算';
  }
  return 'AI兜底';
}

export function getReliabilityMeta(
  item: Pick<
    ResolvedFoodItem,
    'sourceKind' | 'matchMode' | 'confidence' | 'validationFlags' | 'reviewMeta'
  >
): {
  label: string;
  badgeClass: string;
  hintClass: string;
  description: string;
} {
  if (item.reviewMeta) {
    return getReviewVerdictMeta(item.reviewMeta);
  }

  if (item.validationFlags.includes('brand_curated_override')) {
    return {
      label: '品牌营养覆盖',
      badgeClass: 'border-sky-200 bg-sky-50 text-sky-700',
      hintClass: 'border-sky-200 bg-sky-50 text-sky-800',
      description:
        item.validationFlags.includes('db_candidate_rejected')
          ? '已跳过命中的异常数据库候选，改用经过人工校准的品牌营养档案。'
          : '这项命中了人工校准的品牌营养档案，适合处理数据库缺口或明显异常的高频品牌食物。',
    };
  }

  if (item.validationFlags.includes('ai_secondary_review_failed')) {
    return {
      label: '二次复核失败',
      badgeClass: 'border-amber-300 bg-amber-50 text-amber-800',
      hintClass: 'border-amber-200 bg-amber-50 text-amber-900',
      description: '这次二次 AI 复核没有成功，当前展示的是复核前结果，建议再人工确认一次重量与营养。',
    };
  }

  if (item.validationFlags.includes('ai_secondary_adjusted')) {
    return item.sourceKind === 'ai_fallback'
      ? {
          label: 'AI 二次复核已调整',
          badgeClass: 'border-amber-300 bg-amber-50 text-amber-800',
          hintClass: 'border-amber-200 bg-amber-50 text-amber-900',
          description: '这项结果已在首轮解析后再次调用 AI 复核，并对重量或营养做了修正，建议重点确认。',
        }
      : {
          label: '数据库结果已复核',
          badgeClass: 'border-sky-200 bg-sky-50 text-sky-700',
          hintClass: 'border-sky-200 bg-sky-50 text-sky-800',
          description: '数据库已测量字段被保留，二次 AI 复核只补充了缺失营养或修正了估算重量。',
        };
  }

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

  if (item.sourceKind === 'runtime_composite') {
    const aiDriven =
      item.validationFlags.includes('runtime_ai_ingredients') ||
      item.validationFlags.includes('ingredient_ai_macro_estimate');

    return aiDriven
      ? {
          label: '整菜原料聚算需复核',
          badgeClass: 'border-amber-300 bg-amber-50 text-amber-800',
          hintClass: 'border-amber-200 bg-amber-50 text-amber-900',
          description:
            '这道菜已拆成原料后重新聚算，总营养比整菜 AI 更稳，但若部分原料仍靠 AI 宏量估算，细节仍建议人工核对。',
        }
      : {
          label: '整菜原料聚算',
          badgeClass: 'border-emerald-200 bg-emerald-50 text-emerald-700',
          hintClass: 'border-emerald-200 bg-emerald-50 text-emerald-800',
          description:
            '这道菜的营养值由原料逐项查库后运行时聚合而成，可同时查看整菜总量和原料明细。',
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
    case 'ai_secondary_reviewed':
      return '已完成二次 AI 复核';
    case 'ai_secondary_adjusted':
      return '二次 AI 复核已调整结果';
    case 'ai_secondary_review_failed':
      return '二次 AI 复核失败，已回退原结果';
    case 'db_lookup_miss':
      return '数据库未命中';
    case 'db_candidate_rejected':
      return '已跳过异常数据库候选';
    case 'db_candidate_thermodynamic_mismatch':
      return '数据库候选热量与宏量不自洽';
    case 'brand_curated_override':
      return '已应用品牌营养覆盖';
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
    case 'runtime_recipe_ingredients':
      return '已按菜谱原料运行时聚算';
    case 'runtime_ai_ingredients':
      return '已按 AI 拆解原料运行时聚算';
    case 'ingredient_ai_macro_estimate':
      return '部分原料宏量来自 AI 估算';
    case 'ingredient_reference_micros_merged':
      return '部分原料微量营养参考近似数据库食物';
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
