'use server';

import {createHash} from 'node:crypto';
import {headers} from 'next/headers';
import {parseFoodDescription} from '@/ai/flows/parse-food-description-flow';
import type {ParseFoodDescriptionOutput} from '@/lib/food-contract';
import {consumeRateLimit} from '@/lib/rate-limit';
import {getViewer} from '@/lib/auth';

const DESCRIPTION_MAX_LENGTH = 500;
const REQUEST_WINDOW_MS = 60_000;
const ANONYMOUS_REQUEST_LIMIT = 8;
const AUTHENTICATED_REQUEST_LIMIT = 20;

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

function getClientFingerprint(headerStore: Headers): string {
  const clientId = getClientIdentifier(headerStore);
  const userAgent = headerStore.get('user-agent') ?? 'unknown';
  const digest = createHash('sha256').update(`${clientId}:${userAgent}`).digest('hex').slice(0, 16);
  return `${clientId}:${digest}`;
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
  const rateLimit = await consumeRateLimit(
    viewer ? `user:${viewer.id}` : `anon:${getClientFingerprint(headerStore)}`,
    viewer ? AUTHENTICATED_REQUEST_LIMIT : ANONYMOUS_REQUEST_LIMIT,
    REQUEST_WINDOW_MS
  );

  if (!rateLimit.allowed) {
    throw new Error(`Too many requests. Try again in ${rateLimit.retryAfterSeconds} seconds.`);
  }

  return await parseFoodDescription({description: normalizedDescription});
}
