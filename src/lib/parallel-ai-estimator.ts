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

export async function parallelAiEstimate(
  description: string
): Promise<ParallelEstimationResult> {
  const estimators = getActiveEstimators();
  const totalProviders = estimators.length;

  const settled = await Promise.allSettled(
    estimators.map(async (estimator) => {
      const items = await estimator.parse(description);
      return {provider: estimator.provider, items};
    })
  );

  const results: AiEstimationResult[] = [];
  const failures: ParallelEstimationResult['failures'] = [];

  for (let i = 0; i < settled.length; i++) {
    const outcome = settled[i]!;
    const provider = estimators[i]!.provider;

    if (outcome.status === 'fulfilled') {
      results.push(outcome.value);
    } else {
      const message = outcome.reason instanceof Error
        ? outcome.reason.message
        : String(outcome.reason);
      failures.push({provider, error: message});
      markReviewerCooldown(provider, message);
      await recordRuntimeError({
        scope: 'parallel_ai_estimate',
        code: 'estimator_failed',
        message,
        context: {provider, description: description.slice(0, 200)},
      });
    }
  }

  return {results, failures, totalProviders};
}
