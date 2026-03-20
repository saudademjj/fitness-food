import type {AiParsedFoodItem} from '@/lib/food-contract';
import {parseFoodCandidatesWithPrimaryModel} from '@/lib/primary-model';
import {
  isMiniMaxConfigured,
  parseFoodCandidatesWithMiniMax,
} from '@/lib/minimax-client';
import {
  isDeepSeekConfigured,
  parseFoodCandidatesWithDeepSeek,
} from '@/lib/deepseek-client';
import {
  getReviewerCooldown,
  markReviewerCooldown,
} from '@/lib/secondary-review-reviewers';
import {readPositiveIntegerEnv} from '@/lib/env-utils';
import {recordRuntimeError} from '@/lib/runtime-observability';

export type AiEstimatorId = 'primary_model' | 'minimax' | 'deepseek';

export type AiEstimationResult = {
  provider: AiEstimatorId;
  items: AiParsedFoodItem[];
};

export type ParallelEstimationResult = {
  results: AiEstimationResult[];
  failures: Array<{provider: AiEstimatorId; error: string}>;
  totalProviders: number;
};

type Estimator = {
  provider: AiEstimatorId;
  parse: (description: string) => Promise<AiParsedFoodItem[]>;
};

function getActiveEstimators(): Estimator[] {
  const estimators: Estimator[] = [
    {
      provider: 'primary_model',
      parse: parseFoodCandidatesWithPrimaryModel,
    },
  ];

  if (isMiniMaxConfigured() && !getReviewerCooldown('minimax')) {
    estimators.push({
      provider: 'minimax',
      parse: parseFoodCandidatesWithMiniMax,
    });
  }

  if (isDeepSeekConfigured() && !getReviewerCooldown('deepseek')) {
    estimators.push({
      provider: 'deepseek',
      parse: parseFoodCandidatesWithDeepSeek,
    });
  }

  return estimators;
}

const DEFAULT_GLOBAL_TIMEOUT_MS = 30_000;

function getGlobalTimeoutMs(): number {
  return readPositiveIntegerEnv('PARALLEL_ESTIMATE_GLOBAL_TIMEOUT_MS', DEFAULT_GLOBAL_TIMEOUT_MS);
}

export async function parallelAiEstimate(
  description: string
): Promise<ParallelEstimationResult> {
  const estimators = getActiveEstimators();
  const totalProviders = estimators.length;

  const results: AiEstimationResult[] = [];
  const failures: ParallelEstimationResult['failures'] = [];

  const allSettledPromise = Promise.allSettled(
    estimators.map(async (estimator) => {
      try {
        const items = await estimator.parse(description);
        results.push({provider: estimator.provider, items});
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push({provider: estimator.provider, error: message});
        markReviewerCooldown(estimator.provider, message);
        await recordRuntimeError({
          scope: 'parallel_ai_estimate',
          code: 'estimator_failed',
          message,
          context: {provider: estimator.provider, description: description.slice(0, 200)},
        });
      }
    })
  );

  const globalTimeoutMs = getGlobalTimeoutMs();
  const globalTimer = new Promise<'timeout'>((resolve) =>
    setTimeout(() => resolve('timeout'), globalTimeoutMs)
  );

  const outcome = await Promise.race([
    allSettledPromise.then(() => 'all_done' as const),
    globalTimer,
  ]);

  if (outcome === 'timeout') {
    const pending = estimators
      .filter(
        (e) =>
          !results.some((r) => r.provider === e.provider) &&
          !failures.some((f) => f.provider === e.provider)
      )
      .map((e) => e.provider);

    await recordRuntimeError({
      scope: 'parallel_ai_estimate',
      code: 'global_timeout',
      message: `Global timeout after ${globalTimeoutMs}ms; returning ${results.length} partial results. Pending: ${pending.join(', ') || 'none'}`,
      context: {
        globalTimeoutMs,
        completedCount: results.length,
        failedCount: failures.length,
        pendingProviders: pending,
        description: description.slice(0, 200),
      },
    });
  }

  return {results, failures, totalProviders};
}
