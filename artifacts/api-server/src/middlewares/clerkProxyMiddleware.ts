/**
 * Clerk Frontend API Proxy Middleware
 *
 * Proxies Clerk Frontend API requests through your domain, enabling Clerk
 * authentication on custom domains and .replit.app deployments without
 * requiring CNAME DNS configuration.
 *
 * AUTH CONFIGURATION: To manage users, enable/disable login providers
 * (Google, GitHub, etc.), change app branding, or configure OAuth credentials,
 * use the Auth pane in the workspace toolbar. There is no external Clerk
 * dashboard — all auth configuration is done through the Auth pane.
 *
 * IMPORTANT:
 * - Only active in production (Clerk proxying doesn't work for dev instances)
 * - Must be mounted BEFORE express.json() middleware
 * - Native WebViews cannot store Clerk's cross-site __client cookie; normalize
 *   their Origin and bridge that cookie through X-Native-Clerk-Client.
 *
 * Usage in app.ts:
 *   import { CLERK_PROXY_PATH, clerkProxyMiddleware } from "./middlewares/clerkProxyMiddleware";
 *   app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
 */

import type { IncomingHttpHeaders, OutgoingHttpHeaders } from 'http';
import type { RequestHandler } from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';

const CLERK_FAPI = 'https://frontend-api.clerk.dev';
export const CLERK_PROXY_PATH = '/api/__clerk';
const NATIVE_APP_ORIGINS = new Set([
  'capacitor://localhost',
  'ionic://localhost',
  'https://localhost',
  'http://localhost',
]);
const DEFAULT_ALLOW_METHODS = 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS';
const DEFAULT_ALLOW_HEADERS = 'Content-Type, Authorization, X-Native-Clerk-Client';
const MAX_NATIVE_CLERK_CLIENT_COOKIE_LENGTH = 4096;
const NATIVE_CLERK_CLIENT_COOKIE_PATTERN = /^[A-Za-z0-9._~%-]+$/;

export function isValidNativeClerkClientCookie(value: string): boolean {
  return value.length > 0
    && value.length <= MAX_NATIVE_CLERK_CLIENT_COOKIE_LENGTH
    && NATIVE_CLERK_CLIENT_COOKIE_PATTERN.test(value);
}

function getNativeAppOrigin(origin: string | string[] | undefined): string | undefined {
  return typeof origin === 'string' && NATIVE_APP_ORIGINS.has(origin)
    ? origin
    : undefined;
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value.join(', ') : value;
}

function getNativeClientCookieValue(
  setCookieHeaders: string | string[] | undefined,
): string | undefined {
  const setCookies = Array.isArray(setCookieHeaders)
    ? setCookieHeaders
    : setCookieHeaders
      ? [setCookieHeaders]
      : [];
  let clientValue: string | undefined;

  for (const setCookie of setCookies) {
    const [cookiePair, ...attributes] = setCookie.split(';');
    const separator = cookiePair.indexOf('=');
    if (separator < 0 || cookiePair.slice(0, separator).trim() !== '__client') {
      continue;
    }

    const value = cookiePair.slice(separator + 1).trim();
    const isExpired = attributes.some((attribute) => {
      const attributeSeparator = attribute.indexOf('=');
      if (attributeSeparator < 0) return false;

      const name = attribute.slice(0, attributeSeparator).trim().toLowerCase();
      const attributeValue = attribute.slice(attributeSeparator + 1).trim();
      if (name === 'max-age') {
        const maxAge = Number(attributeValue);
        return Number.isFinite(maxAge) && maxAge <= 0;
      }
      if (name === 'expires') {
        const expiresAt = Date.parse(attributeValue);
        return Number.isFinite(expiresAt) && expiresAt <= Date.now();
      }
      return false;
    });

    if (value === '' || isExpired) {
      clientValue = '';
    } else if (isValidNativeClerkClientCookie(value)) {
      clientValue = value;
    } else {
      clientValue = '';
    }
  }

  return clientValue;
}

function appendHeaderToken(
  value: string | string[] | undefined,
  token: string,
): string {
  const values = (firstHeaderValue(value) ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (values.includes('*')) {
    return token;
  }
  if (!values.some((part) => part.toLowerCase() === token.toLowerCase())) {
    values.push(token);
  }
  return values.join(', ');
}

function appendVaryOrigin(headers: OutgoingHttpHeaders): void {
  const current = headers.vary;
  const values = (Array.isArray(current) ? current : [current])
    .flatMap((value) => typeof value === 'string' ? value.split(',') : [])
    .map((value) => value.trim())
    .filter(Boolean);
  if (!values.some((value) => value.toLowerCase() === 'origin')) {
    values.push('Origin');
  }
  headers.vary = values.join(', ');
}

function setNativeCorsHeaders(
  req: { headers: IncomingHttpHeaders },
  headers: OutgoingHttpHeaders,
  origin: string,
): void {
  headers['access-control-allow-origin'] = origin;
  headers['access-control-allow-credentials'] = 'true';
  const allowedHeaders = appendHeaderToken(
    firstHeaderValue(req.headers['access-control-request-headers'])?.trim()
    || firstHeaderValue(headers['access-control-allow-headers'])
    || DEFAULT_ALLOW_HEADERS,
    'Authorization',
  );
  headers['access-control-allow-headers'] = appendHeaderToken(
    allowedHeaders,
    'X-Native-Clerk-Client',
  );
  headers['access-control-allow-methods'] = DEFAULT_ALLOW_METHODS;
  const exposedHeaders = appendHeaderToken(
    firstHeaderValue(headers['access-control-expose-headers']),
    'Authorization',
  );
  headers['access-control-expose-headers'] = appendHeaderToken(
    exposedHeaders,
    'X-Native-Clerk-Client',
  );
  appendVaryOrigin(headers);
}

function getProxyPublicOrigin(req: { headers: IncomingHttpHeaders }): string {
  const protocol = req.headers['x-forwarded-proto'] || 'https';
  const host = getClerkProxyHost(req) || '';
  return `${protocol}://${host}`;
}

/**
 * Returns the first effective public hostname for the given request,
 * preferring x-forwarded-host over the Host header so callers behind a
 * proxy see the original client-facing host.
 *
 * x-forwarded-host can take three shapes:
 *   - undefined (no proxy involved)
 *   - a single string (one proxy hop)
 *   - a comma-delimited string when an upstream appended rather than
 *     replaced the header (Node folds duplicate headers this way), or a
 *     string[] in some Express typings
 * In the multi-value case, the leftmost value is the original client-
 * facing host. Take that one in all forms. Exported so that app.ts
 * (clerkMiddleware callback) and this proxy middleware agree on which
 * hostname is canonical — otherwise multi-domain/custom-domain flows
 * break.
 */
export function getClerkProxyHost(req: {
  headers: IncomingHttpHeaders;
}): string | undefined {
  const forwarded = req.headers['x-forwarded-host'];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const firstHop = raw?.split(',')[0]?.trim();
  return firstHop || req.headers.host?.trim() || undefined;
}

export function clerkProxyMiddleware(): RequestHandler {
  // Only run proxy in production — Clerk proxying doesn't work for dev instances
  if (process.env.NODE_ENV !== 'production') {
    return (_req, _res, next) => next();
  }

  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) {
    return (_req, _res, next) => next();
  }

  const proxyMiddleware = createProxyMiddleware({
    target: CLERK_FAPI,
    changeOrigin: true,
    // Take over the response so it can be re-sent with a Content-Length (see
    // proxyRes); the deployment edge rejects chunked proxied responses.
    selfHandleResponse: true,
    pathRewrite: (path: string) =>
      path.replace(new RegExp(`^${CLERK_PROXY_PATH}`), ''),
    on: {
      proxyReq: (proxyReq, req) => {
        const publicOrigin = getProxyPublicOrigin(req);
        const proxyUrl = `${publicOrigin}${CLERK_PROXY_PATH}`;

        proxyReq.setHeader('Clerk-Proxy-Url', proxyUrl);
        proxyReq.setHeader('Clerk-Secret-Key', secretKey);
        if (getNativeAppOrigin(req.headers.origin)) {
          proxyReq.setHeader('Origin', publicOrigin);
          if (req.headers.authorization !== undefined) {
            proxyReq.setHeader('Authorization', req.headers.authorization);
          }
          const nativeClientValue = firstHeaderValue(
            req.headers['x-native-clerk-client'],
          )?.trim();
          if (nativeClientValue && isValidNativeClerkClientCookie(nativeClientValue)) {
            // This value has passed the strict length and character allowlist;
            // do not forward any other WebView-supplied Cookie values to Clerk.
            proxyReq.setHeader('Cookie', `__client=${nativeClientValue}`);
          } else {
            proxyReq.removeHeader('Cookie');
          }
        }
        proxyReq.removeHeader('X-Native-Clerk-Client');

        const xff = req.headers['x-forwarded-for'];
        const clientIp =
          (Array.isArray(xff) ? xff[0] : xff)?.split(',')[0]?.trim() ||
          req.socket?.remoteAddress ||
          '';
        if (clientIp) {
          proxyReq.setHeader('X-Forwarded-For', clientIp);
        }
      },
      // Clerk's dynamic Frontend API responses (/v1/environment, /v1/client,
      // JWKS, ...) arrive without a Content-Length, so relaying them would use
      // Transfer-Encoding: chunked — which the deployment edge (Cloud Run)
      // rejects, turning the app's 200 into a 500. Buffer only those so they can
      // be re-sent with a Content-Length; the body is forwarded untouched so
      // Content-Encoding is preserved. Length-known responses (e.g. /npm/*
      // assets) and body-less responses stream through without buffering.
      proxyRes: (proxyRes, req, res) => {
        const headers = { ...proxyRes.headers };
        const nativeOrigin = getNativeAppOrigin(req.headers.origin);
        if (nativeOrigin) {
          setNativeCorsHeaders(req, headers, nativeOrigin);
          const nativeClientValue = getNativeClientCookieValue(
            proxyRes.headers['set-cookie'],
          );
          if (nativeClientValue !== undefined) {
            headers['x-native-clerk-client'] = nativeClientValue;
          }
        }
        // Transfer-Encoding/Connection are hop-by-hop (RFC 7230 §6.1).
        delete headers['transfer-encoding'];
        delete headers['connection'];
        delete headers['keep-alive'];

        const status = proxyRes.statusCode ?? 502;
        // Content-Length is forbidden on 1xx/204; HEAD/304 may keep theirs.
        if (status < 200 || status === 204) {
          delete headers['content-length'];
        }

        const bodyless =
          req.method === 'HEAD' ||
          status < 200 ||
          status === 204 ||
          status === 304;
        if (headers['content-length'] !== undefined || bodyless) {
          res.writeHead(status, headers);
          // Headers are already sent, so abort the response if the upstream
          // stream errors mid-pipe (e.g. ECONNRESET) rather than leaving an
          // unhandled 'error' or a hung client.
          proxyRes.on('error', () => res.destroy());
          proxyRes.pipe(res);
          return;
        }

        const chunks: Buffer[] = [];
        proxyRes.on('data', (chunk: Buffer) => chunks.push(chunk));
        proxyRes.on('end', () => {
          const body = Buffer.concat(chunks);
          headers['content-length'] = String(body.length);
          res.writeHead(status, headers);
          res.end(body);
        });
        proxyRes.on('error', () => {
          if (!res.headersSent) {
            // Set a length so the empty 502 isn't sent chunked (which the
            // deployment edge would reject just like the original response).
            res.writeHead(502, { 'content-length': '0' });
          }
          res.end();
        });
      },
    },
  }) as RequestHandler;

  return (req, res, next) => {
    const nativeOrigin = getNativeAppOrigin(req.headers.origin);
    const nativeClientHeader = firstHeaderValue(
      req.headers['x-native-clerk-client'],
    );
    if (
      nativeOrigin
      && nativeClientHeader !== undefined
      && !isValidNativeClerkClientCookie(nativeClientHeader.trim())
    ) {
      res.status(400).json({ error: 'Invalid native Clerk client cookie' });
      return;
    }
    if (req.method === 'OPTIONS' && nativeOrigin) {
      const headers: OutgoingHttpHeaders = {};
      setNativeCorsHeaders(req, headers, nativeOrigin);
      const requestedMethod = firstHeaderValue(req.headers['access-control-request-method'])?.trim();
      if (requestedMethod) {
        headers['access-control-allow-methods'] = requestedMethod;
      }
      res.writeHead(204, headers);
      res.end();
      return;
    }
    proxyMiddleware(req, res, next);
  };
}
