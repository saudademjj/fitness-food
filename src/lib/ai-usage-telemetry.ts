import {getDbPool} from '@/lib/db';

export async function recordAiUsageTelemetry(payload: {
  provider: string;
  model: string;
  requestKind: string;
  inputPreview: string;
  promptTokens?: number | null;
  completionTokens?: number | null;
  totalTokens?: number | null;
  durationMs: number;
  attemptCount: number;
  success: boolean;
  errorMessage?: string | null;
}): Promise<void> {
  try {
    const pool = getDbPool();
    await pool.query(
      `
        INSERT INTO app.ai_usage_telemetry (
          provider,
          model,
          request_kind,
          input_preview,
          prompt_tokens,
          completion_tokens,
          total_tokens,
          duration_ms,
          attempt_count,
          success,
          error_message
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      `,
      [
        payload.provider,
        payload.model,
        payload.requestKind,
        payload.inputPreview,
        payload.promptTokens ?? null,
        payload.completionTokens ?? null,
        payload.totalTokens ?? null,
        payload.durationMs,
        payload.attemptCount,
        payload.success,
        payload.errorMessage ?? null,
      ]
    );
  } catch (error) {
    console.warn('Failed to record AI usage telemetry.', error);
  }
}
