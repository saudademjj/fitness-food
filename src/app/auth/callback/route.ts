import {NextResponse} from 'next/server';
import {consumeMagicLinkToken, SESSION_COOKIE_NAME} from '@/lib/auth';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get('token');

  if (!token) {
    return NextResponse.redirect(new URL('/?auth=invalid', url));
  }

  try {
    const result = await consumeMagicLinkToken(token);
    const response = NextResponse.redirect(new URL('/?auth=success', url));
    response.cookies.set(SESSION_COOKIE_NAME, result.sessionToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      expires: result.sessionExpiresAt,
      path: '/',
    });
    return response;
  } catch {
    return NextResponse.redirect(new URL('/?auth=invalid', url));
  }
}
