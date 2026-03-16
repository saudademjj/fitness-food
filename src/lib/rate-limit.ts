import {getDbPool} from '@/lib/db';

type Bucket = {
  count: number;
  bucketStartedAt: number;
};

const memoryBuckets = new Map<string, Bucket>();
const SLIDING_BUCKET_MS = 10_000;

function consumeRateLimitInMemory(
  key: string,
  limit: number,
  windowMs: number
): {allowed: boolean; retryAfterSeconds: number} {
  const now = Date.now();
  const currentBucket = Math.floor(now / SLIDING_BUCKET_MS) * SLIDING_BUCKET_MS;
  const earliestBucket = currentBucket - windowMs + SLIDING_BUCKET_MS;

  for (const [bucketKey, bucket] of memoryBuckets.entries()) {
    if (!bucketKey.startsWith(`${key}:`) || bucket.bucketStartedAt < earliestBucket) {
      memoryBuckets.delete(bucketKey);
    }
  }

  const matchingBuckets = [...memoryBuckets.entries()]
    .filter(([bucketKey, bucket]) => bucketKey.startsWith(`${key}:`) && bucket.bucketStartedAt >= earliestBucket)
    .map(([, bucket]) => bucket);
  const currentKey = `${key}:${currentBucket}`;
  const current = memoryBuckets.get(currentKey);
  const totalHits = matchingBuckets.reduce((sum, bucket) => sum + bucket.count, 0);

  if (totalHits >= limit) {
    const oldestBucket = matchingBuckets.reduce<number>(
      (min, bucket) => Math.min(min, bucket.bucketStartedAt),
      currentBucket
    );
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((oldestBucket + windowMs - now) / 1000)),
    };
  }

  if (!current) {
    memoryBuckets.set(currentKey, {
      count: 1,
      bucketStartedAt: currentBucket,
    });
  } else {
    current.count += 1;
    memoryBuckets.set(currentKey, current);
  }

  return {allowed: true, retryAfterSeconds: 0};
}

export async function consumeRateLimit(
  key: string,
  limit: number,
  windowMs: number
): Promise<{allowed: boolean; retryAfterSeconds: number}> {
  const now = Date.now();
  const bucketStartedAt = Math.floor(now / SLIDING_BUCKET_MS) * SLIDING_BUCKET_MS;
  const earliestBucket = bucketStartedAt - windowMs + SLIDING_BUCKET_MS;

  try {
    const pool = getDbPool();
    const result = await pool.query<{total_hits: number; oldest_bucket_ms: number | null}>(
      `
        WITH upsert AS (
          INSERT INTO app.rate_limit_bucket (subject_key, window_started_at, hit_count, updated_at)
          VALUES ($1, to_timestamp($2 / 1000.0), 1, NOW())
          ON CONFLICT (subject_key, window_started_at)
          DO UPDATE SET
            hit_count = app.rate_limit_bucket.hit_count + 1,
            updated_at = NOW()
          RETURNING 1
        )
        SELECT
          COALESCE(SUM(hit_count), 0)::int AS total_hits,
          (EXTRACT(EPOCH FROM MIN(window_started_at)) * 1000)::bigint AS oldest_bucket_ms
        FROM app.rate_limit_bucket
        WHERE subject_key = $1
          AND window_started_at >= to_timestamp($3 / 1000.0)
      `,
      [key, bucketStartedAt, earliestBucket]
    );

    const hitCount = result.rows[0]?.total_hits ?? 1;
    if (hitCount > limit) {
      const oldestBucket = result.rows[0]?.oldest_bucket_ms ?? bucketStartedAt;
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((oldestBucket + windowMs - now) / 1000)),
      };
    }

    return {allowed: true, retryAfterSeconds: 0};
  } catch {
    return consumeRateLimitInMemory(key, limit, windowMs);
  }
}
