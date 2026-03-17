'use server';

import {createHash, randomUUID} from 'node:crypto';
import {cookies, headers} from 'next/headers';
import {parseFoodDescription} from '@/ai/flows/parse-food-description-flow';
import type {ParseFoodDescriptionOutput} from '@/lib/food-contract';
import {consumeRateLimit} from '@/lib/rate-limit';
import {getViewer} from '@/lib/auth';

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

async function getAnonymousRateLimitKey(headerStore: Headers): Promise<string> {
  const cookieStore = await cookies();
  let anonymousId = cookieStore.get(ANONYMOUS_RATE_LIMIT_COOKIE_NAME)?.value?.trim();

  if (!anonymousId) {
    anonymousId = randomUUID();
    cookieStore.set(ANONYMOUS_RATE_LIMIT_COOKIE_NAME, anonymousId, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
    });
  }

  return `anon:${getClientFingerprint(headerStore, anonymousId)}`;
}

export async function parseDescriptionAction(description: string): Promise<ParseFoodDescriptionOutput> {
  const normalizedDescription = description?.trim();

  if (!normalizedDescription) {
    throw new Error('Description is required');
  }

  if (normalizedDescription.length > DESCRIPTION_MAX_LENGTH) {
    throw new Error(`Description must be ${DESCRIPTION_MAX_LENGTH} characters or fewer`);
  }

  const headerStore = await headers();
  const viewer = await getViewer();
  const rateLimitKey = viewer
    ? `user:${viewer.id}`
    : await getAnonymousRateLimitKey(headerStore);
  const rateLimit = await consumeRateLimit(
    rateLimitKey,
    viewer ? AUTHENTICATED_REQUEST_LIMIT : ANONYMOUS_REQUEST_LIMIT,
    REQUEST_WINDOW_MS
  );

  if (!rateLimit.allowed) {
    throw new Error(`Too many requests. Try again in ${rateLimit.retryAfterSeconds} seconds.`);
  }

  return await parseFoodDescription({description: normalizedDescription});
}
