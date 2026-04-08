import type { NextRequest } from 'next/server';

const serverApiBaseUrl =
  process.env.SERVER_API_BASE_URL?.replace(/\/+$/, '') ||
  'http://localhost:3001/api';

function buildUpstreamUrl(request: NextRequest, path: string[]): string {
  const requestUrl = new URL(request.url);
  const upstreamUrl = new URL(
    `${serverApiBaseUrl}/${path.map(encodeURIComponent).join('/')}`,
  );

  upstreamUrl.search = requestUrl.search;

  return upstreamUrl.toString();
}

function buildUpstreamHeaders(request: NextRequest): Headers {
  const headers = new Headers();

  for (const [key, value] of request.headers.entries()) {
    if (key === 'host' || key === 'content-length') {
      continue;
    }

    headers.set(key, value);
  }

  return headers;
}

function copyUpstreamResponseHeaders(upstreamResponse: Response): Headers {
  const headers = new Headers();

  for (const [key, value] of upstreamResponse.headers.entries()) {
    if (key.toLowerCase() === 'set-cookie') {
      continue;
    }

    headers.append(key, value);
  }

  const setCookieHeaders = (
    upstreamResponse.headers as Headers & {
      getSetCookie?: () => string[];
    }
  ).getSetCookie?.();

  if (setCookieHeaders && setCookieHeaders.length > 0) {
    for (const cookie of setCookieHeaders) {
      headers.append('set-cookie', cookie);
    }

    return headers;
  }

  const legacySetCookieHeader = upstreamResponse.headers.get('set-cookie');

  if (legacySetCookieHeader) {
    headers.append('set-cookie', legacySetCookieHeader);
  }

  return headers;
}

async function proxyRequest(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const { path } = await context.params;
  const method = request.method.toUpperCase();
  const headers = buildUpstreamHeaders(request);
  const body =
    method === 'GET' || method === 'HEAD'
      ? undefined
      : await request.arrayBuffer();
  const upstreamResponse = await fetch(buildUpstreamUrl(request, path), {
    method,
    headers,
    ...(body ? { body } : {}),
    cache: 'no-store',
    redirect: 'manual',
  });
  const responseHeaders = copyUpstreamResponseHeaders(upstreamResponse);

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    headers: responseHeaders,
  });
}

export const dynamic = 'force-dynamic';

export function GET(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  return proxyRequest(request, context);
}

export function POST(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  return proxyRequest(request, context);
}

export function PUT(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  return proxyRequest(request, context);
}

export function PATCH(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  return proxyRequest(request, context);
}

export function DELETE(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  return proxyRequest(request, context);
}

export function OPTIONS(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  return proxyRequest(request, context);
}

export function HEAD(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  return proxyRequest(request, context);
}
