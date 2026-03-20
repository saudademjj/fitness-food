import type {AiReviewedFoodItem, ResolvedFoodItems} from '@/lib/food-contract';
import {readBooleanEnv, readPositiveIntegerEnv} from '@/lib/env-utils';
import {
  getDeepseekReviewModel,
  reviewResolvedFoodsWithDeepseek,
} from '@/lib/deepseek';
import {
  getMiniMaxReviewerModel,
  reviewResolvedFoodsWithMiniMax,
} from '@/lib/minimax-review';
import {reviewResolvedFoodsWithPrimaryModel} from '@/lib/primary-model';

export type SecondaryReviewer = {
  provider: string;
  serialGroup?: string;
  review: (
    sourceDescription: string,
    foods: ResolvedFoodItems,
    weightLocks: boolean[]
  ) => Promise<AiReviewedFoodItem[]>;
};

export type SecondaryReviewerResult = {
  provider: string;
  result: PromiseSettledResult<{provider: string; items: AiReviewedFoodItem[]}>;
};

type ReviewerCooldownState = {
  disabledUntil: number;
  reasonKind: 'rate_limit' | 'timeout' | 'transient';
};

declare global {
  // eslint-disable-next-line no-var
  var __fitnessFoodReviewerCooldowns:
    | Map<string, ReviewerCooldownState>
    | undefined;
}

const OPTIONAL_REVIEWER_COOLDOWN_MS = 10 * 60 * 1000;

function isOptionalReviewerEnabled(
  kind: 'minimax' | 'deepseek'
): boolean {
  if (kind === 'minimax') {
    return readBooleanEnv(
      [
        'SECONDARY_REVIEW_ENABLE_MINIMAX',
        'SECONDARY_REVIEW_ENABLE_MINIMAX_REVIEWER',
        'SECONDARY_REVIEW_ENABLE_SCNET',
        'SCNET_ENABLE_SECONDARY_REVIEW',
      ],
      true
    );
  }

  return readBooleanEnv(
    ['SECONDARY_REVIEW_ENABLE_DEEPSEEK', 'DEEPSEEK_ENABLE_SECONDARY_REVIEW'],
    true
  );
}

function getOptionalReviewerCooldownMs(): number {
  return readPositiveIntegerEnv(
    [
      'SECONDARY_REVIEW_PROVIDER_COOLDOWN_MS',
      'SECONDARY_REVIEW_FAILURE_COOLDOWN_MS',
    ],
    OPTIONAL_REVIEWER_COOLDOWN_MS
  );
}

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

function getReviewerCooldownStore(): Map<string, ReviewerCooldownState> {
  if (!global.__fitnessFoodReviewerCooldowns) {
    global.__fitnessFoodReviewerCooldowns = new Map();
  }

  return global.__fitnessFoodReviewerCooldowns;
}

function detectReviewerCooldownReason(
  message: string
): ReviewerCooldownState['reasonKind'] | null {
  const normalized = message.trim().toLowerCase();

  if (
    normalized.includes('429') ||
    normalized.includes('rate limited') ||
    normalized.includes('rate-limit') ||
    normalized.includes('temporarily rate-limited') ||
    normalized.includes('quota')
  ) {
    return 'rate_limit';
  }

  if (
    normalized.includes('timed out') ||
    normalized.includes('timeout') ||
    normalized.includes('time out')
  ) {
    return 'timeout';
  }

  if (
    normalized.includes('temporarily unavailable') ||
    normalized.includes('overloaded') ||
    normalized.includes('upstream')
  ) {
    return 'transient';
  }

  return null;
}

function shouldUseReviewerCooldown(provider: string): boolean {
  return provider !== 'primary_model';
}

export function getReviewerCooldown(provider: string): ReviewerCooldownState | null {
  if (!shouldUseReviewerCooldown(provider)) {
    return null;
  }

  const store = getReviewerCooldownStore();
  const state = store.get(provider);
  if (!state) {
    return null;
  }

  if (state.disabledUntil <= Date.now()) {
    store.delete(provider);
    return null;
  }

  return state;
}

export function clearReviewerCooldown(provider: string): void {
  if (!shouldUseReviewerCooldown(provider)) {
    return;
  }

  getReviewerCooldownStore().delete(provider);
}

export function markReviewerCooldown(provider: string, message: string): void {
  if (!shouldUseReviewerCooldown(provider)) {
    return;
  }

  const reasonKind = detectReviewerCooldownReason(message);
  if (!reasonKind) {
    return;
  }

  getReviewerCooldownStore().set(provider, {
    disabledUntil: Date.now() + getOptionalReviewerCooldownMs(),
    reasonKind,
  });
}

export function formatReviewerCooldownMessage(
  provider: string,
  state: ReviewerCooldownState
): string {
  const secondsRemaining = Math.max(
    1,
    Math.ceil((state.disabledUntil - Date.now()) / 1000)
  );
  const reasonLabel =
    state.reasonKind === 'rate_limit'
      ? '限流'
      : state.reasonKind === 'timeout'
        ? '超时'
        : '暂时不可用';

  return `${getReviewerLabel(provider)} 冷却中：上次${reasonLabel}后还需等待约 ${secondsRemaining} 秒`;
}

export function summarizeReviewerFailure(provider: string, message: string): string {
  const label = getReviewerLabel(provider);
  const normalized = message.trim().toLowerCase();
  const cooldownReason = detectReviewerCooldownReason(message);

  if (normalized.includes('incompatible_review_result')) {
    return `${label} 返回结果不可兼容`;
  }

  if (cooldownReason === 'rate_limit') {
    return `${label} 速率限制`;
  }

  if (cooldownReason === 'timeout') {
    return `${label} 超时`;
  }

  if (cooldownReason === 'transient') {
    return `${label} 暂时不可用`;
  }

  if (normalized.includes('not configured')) {
    return `${label} 未配置`;
  }

  return `${label} 未返回`;
}

export function getDefaultReviewers(): SecondaryReviewer[] {
  const deepseekReviewModel = getDeepseekReviewModel();
  const miniMaxReviewModel = getMiniMaxReviewerModel();

  return [
    {
      provider: 'primary_model',
      review: reviewResolvedFoodsWithPrimaryModel,
    },
    ...(isOptionalReviewerEnabled('minimax') && miniMaxReviewModel
      ? [
          {
            provider: miniMaxReviewModel.provider,
            review: reviewResolvedFoodsWithMiniMax,
          } satisfies SecondaryReviewer,
        ]
      : []),
    ...(isOptionalReviewerEnabled('deepseek') && deepseekReviewModel
      ? [
          {
            provider: deepseekReviewModel.provider,
            review: reviewResolvedFoodsWithDeepseek,
          } satisfies SecondaryReviewer,
        ]
      : []),
  ];
}

export async function runSecondaryReviewers(params: {
  reviewers: SecondaryReviewer[];
  sourceDescription: string;
  foods: ResolvedFoodItems;
  weightLocks: boolean[];
}): Promise<SecondaryReviewerResult[]> {
  const independent: SecondaryReviewer[] = [];
  const grouped = new Map<string, SecondaryReviewer[]>();

  for (const reviewer of params.reviewers) {
    if (!reviewer.serialGroup) {
      independent.push(reviewer);
      continue;
    }

    const bucket = grouped.get(reviewer.serialGroup) ?? [];
    bucket.push(reviewer);
    grouped.set(reviewer.serialGroup, bucket);
  }

  const independentResults = await Promise.all(
    independent.map(async (reviewer) => {
      try {
        return {
          provider: reviewer.provider,
          result: {
            status: 'fulfilled' as const,
            value: {
              provider: reviewer.provider,
              items: await reviewer.review(
                params.sourceDescription,
                params.foods,
                params.weightLocks
              ),
            },
          },
        };
      } catch (reason) {
        return {
          provider: reviewer.provider,
          result: {
            status: 'rejected' as const,
            reason,
          },
        };
      }
    })
  );

  const groupedResults = await Promise.all(
    Array.from(grouped.values()).map(async (reviewers) => {
      const results: SecondaryReviewerResult[] = [];

      for (const reviewer of reviewers) {
        try {
          results.push({
            provider: reviewer.provider,
            result: {
              status: 'fulfilled',
              value: {
                provider: reviewer.provider,
                items: await reviewer.review(
                  params.sourceDescription,
                  params.foods,
                  params.weightLocks
                ),
              },
            },
          });
        } catch (reason) {
          results.push({
            provider: reviewer.provider,
            result: {
              status: 'rejected',
              reason,
            },
          });
        }
      }

      return results;
    })
  );

  return [...independentResults, ...groupedResults.flat()];
}
