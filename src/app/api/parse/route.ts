import {createHash, randomUUID} from 'node:crypto';

import {NextRequest, NextResponse} from 'next/server';

import {parseFoodDescription} from '@/ai/flows/parse-food-description-flow';
import {getViewer} from '@/lib/auth';
import {ParseFoodDescriptionOutputSchema} from '@/lib/food-contract';
import {consumeRateLimit} from '@/lib/rate-limit';

const DESCRIPTION_MAX_LENGTH = 500;
const REQUEST_WINDOW_MS = 60_000;
const ANONYMOUS_REQUEST_LIMIT = 8;
const AUTHENTICATED_REQUEST_LIMIT = 20;
const ANONYMOUS_RATE_LIMIT_COOKIE_NAME = 'fitness_food_anon_id';

function getClientIdentifier(headerStore: Headers): string {
  const forwardedFor = headerStore.get('x-forwarded-for');
  if (forwardedFor) {
    return forwardedFor.split(',')[0]!.trim();
  }

  const realIp = headerStore.get('x-real-ip');
  if (realIp) {
    return realIp.trim();
  }

  return 'unknown';
}

function getClientFingerprint(headerStore: Headers, anonymousId: string): string {
  const clientId = getClientIdentifier(headerStore);
  const userAgent = headerStore.get('user-agent') ?? 'unknown';
  const acceptLanguage = headerStore.get('accept-language') ?? 'unknown';
  const secChUa = headerStore.get('sec-ch-ua') ?? 'unknown';
  const secChUaPlatform = headerStore.get('sec-ch-ua-platform') ?? 'unknown';
  const digest = createHash('sha256')
    .update(
      `${anonymousId}:${clientId}:${userAgent}:${acceptLanguage}:${secChUa}:${secChUaPlatform}`
    )
    .digest('hex')
    .slice(0, 16);

  return `${anonymousId}:${digest}`;
}

function buildJsonError(message: string, status: number): NextResponse {
  return NextResponse.json({error: message}, {status});
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const payload = (await request.json()) as {description?: unknown};
    const normalizedDescription =
      typeof payload.description === 'string' ? payload.description.trim() : '';

    if (!normalizedDescription) {
      return buildJsonError('请输入要解析的食物描述。', 400);
    }

    if (normalizedDescription.length > DESCRIPTION_MAX_LENGTH) {
      return buildJsonError(
        `描述长度不能超过 ${DESCRIPTION_MAX_LENGTH} 个字符。`,
        400
      );
    }

    const viewer = await getViewer();
    let anonymousId =
      request.cookies.get(ANONYMOUS_RATE_LIMIT_COOKIE_NAME)?.value?.trim() || null;

    if (!viewer && !anonymousId) {
      anonymousId = randomUUID();
    }

    const rateLimitKey = viewer
      ? `user:${viewer.id}`
      : `anon:${getClientFingerprint(request.headers, anonymousId!)}`;
    const rateLimit = await consumeRateLimit(
      rateLimitKey,
      viewer ? AUTHENTICATED_REQUEST_LIMIT : ANONYMOUS_REQUEST_LIMIT,
      REQUEST_WINDOW_MS
    );

    if (!rateLimit.allowed) {
      return buildJsonError(
        `请求过于频繁，请在 ${rateLimit.retryAfterSeconds} 秒后再试。`,
        429
      );
    }

    const result = await parseFoodDescription({description: normalizedDescription});
    const response = NextResponse.json(ParseFoodDescriptionOutputSchema.parse(result));

    if (!viewer && anonymousId && !request.cookies.get(ANONYMOUS_RATE_LIMIT_COOKIE_NAME)?.value) {
      response.cookies.set(ANONYMOUS_RATE_LIMIT_COOKIE_NAME, anonymousId, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: 60 * 60 * 24 * 365,
      });
    }

    return response;
  } catch (error) {
    const message =
      error instanceof Error && error.message.trim()
        ? error.message
        : '连接解析服务时出现异常，请稍后再试。';
    return buildJsonError(message, 500);
  }
}
