// 정적 파일 서버 + TMAP 보행자 경로 프록시.
// TMAP_APP_KEY는 서버 환경변수 또는 프로젝트 루트 .env에서만 읽고 브라우저에 전달하지 않습니다.
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const http = require('node:http');
const fs = require('node:fs');

const ROOT = __dirname;
const HOST = process.env.HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');
const PORT = Number(process.env.PORT || 3000);
const TMAP_PEDESTRIAN_ENDPOINT = 'https://apis.openapi.sk.com/tmap/routes/pedestrian?version=1';
const MAX_BODY_BYTES = 16 * 1024;
const RATE_WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_CLIENT = 60;
const MAX_REQUESTS_GLOBAL = 300;
const rateBuckets = new Map();
const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon'
};

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  response.end(JSON.stringify(payload));
}

function isRateLimited(request) {
  const now = Date.now();
  for (const [key, bucket] of rateBuckets) {
    if (now - bucket.windowStartedAt >= RATE_WINDOW_MS) rateBuckets.delete(key);
  }

  const clientKey = request.socket.remoteAddress || 'unknown-client';
  const globalBucket = rateBuckets.get('global') || { windowStartedAt: now, count: 0 };
  const clientBucket = rateBuckets.get(clientKey) || { windowStartedAt: now, count: 0 };
  if (globalBucket.count >= MAX_REQUESTS_GLOBAL || clientBucket.count >= MAX_REQUESTS_PER_CLIENT) return true;
  if (rateBuckets.size > 5000) return true;

  globalBucket.count += 1;
  clientBucket.count += 1;
  rateBuckets.set('global', globalBucket);
  rateBuckets.set(clientKey, clientBucket);
  return false;
}

function isCoordinate(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return false;
  if (typeof value === 'string' && !value.trim()) return false;
  const number = Number(value);
  return Number.isFinite(number) && number >= -180 && number <= 180;
}

function isLatitude(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return false;
  if (typeof value === 'string' && !value.trim()) return false;
  const number = Number(value);
  return Number.isFinite(number) && number >= -90 && number <= 90;
}

function validateTmapRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, '요청 본문은 JSON 객체여야 합니다.');
  }
  const { startX, startY, endX, endY } = body;
  if (![startX, endX].every(isCoordinate) || ![startY, endY].every(isLatitude)) {
    throw new HttpError(400, '출발지와 도착지 좌표가 올바르지 않습니다.');
  }

  const cleanName = (value, fallback) => typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 64) || fallback
    : fallback;

  // 브라우저가 임의의 TMAP URL/파라미터를 지정하지 못하도록 필요한 값만 서버에서 구성합니다.
  return {
    startX: Number(startX).toFixed(6),
    startY: Number(startY).toFixed(6),
    endX: Number(endX).toFixed(6),
    endY: Number(endY).toFixed(6),
    startName: cleanName(body.startName, '출발지'),
    endName: cleanName(body.endName, '휴식공간'),
    reqCoordType: 'WGS84GEO',
    resCoordType: 'WGS84GEO'
  };
}

function redactTmapSecret(value, appKey) {
  let text = value == null ? '' : String(value);
  if (appKey) text = text.split(appKey).join('[REDACTED]');
  return text.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 500);
}

function extractTmapError(responseBody, upstream, appKey) {
  let payload = null;
  try { payload = JSON.parse(responseBody); } catch { /* TMAP 응답이 JSON이 아닐 수 있습니다. */ }
  const providerError = payload?.error;
  const rawCode = providerError && typeof providerError === 'object'
    ? providerError.code
    : payload?.errorCode ?? payload?.code;
  const rawMessage = providerError && typeof providerError === 'object'
    ? providerError.message
    : (typeof providerError === 'string' ? providerError : payload?.message);
  const code = redactTmapSecret(rawCode ?? '', appKey);
  const message = redactTmapSecret(
    rawMessage ?? responseBody ?? upstream.statusText ?? `TMAP HTTP ${upstream.status}`,
    appKey
  ) || `TMAP HTTP ${upstream.status}`;
  return { code, message };
}

async function readJsonBody(request) {
  const contentLength = Number(request.headers['content-length'] || 0);
  if (contentLength > MAX_BODY_BYTES) {
    request.resume();
    throw new HttpError(413, '요청 본문이 너무 큽니다.');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, '요청 본문이 너무 큽니다.');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, '올바른 JSON 요청이 아닙니다.');
  }
}

async function handleTmapProxy(request, response) {
  if (request.method !== 'POST') {
    response.writeHead(405, { Allow: 'POST', 'Cache-Control': 'no-store' }).end('Method Not Allowed');
    return;
  }
  if (!String(request.headers['content-type'] || '').toLowerCase().includes('application/json')) {
    sendJson(response, 415, { error: { message: 'Content-Type은 application/json이어야 합니다.' } });
    return;
  }
  if (isRateLimited(request)) {
    sendJson(response, 429, { error: { message: '요청이 많습니다. 잠시 후 다시 시도해 주세요.' } });
    request.resume();
    return;
  }

  try {
    const requestBody = validateTmapRequest(await readJsonBody(request));
    const appKey = process.env.TMAP_APP_KEY?.trim();
    if (!appKey) {
      sendJson(response, 503, { error: { message: '프로젝트 루트 .env 파일에 TMAP_APP_KEY를 설정해 주세요.' } });
      return;
    }

    const upstream = await fetch(TMAP_PEDESTRIAN_ENDPOINT, {
      method: 'POST',
      headers: {
        appKey,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(20_000)
    });
    const responseBody = await upstream.text();

    if (!upstream.ok) {
      const tmapError = extractTmapError(responseBody, upstream, appKey);
      console.error(
        `[TMAP] HTTP ${upstream.status} error.code=${tmapError.code || '(없음)'} error.message=${tmapError.message}`
      );
      sendJson(response, upstream.status, {
        error: { code: tmapError.code || null, message: tmapError.message },
        httpStatus: upstream.status
      });
      return;
    }

    response.writeHead(upstream.status, {
      'Content-Type': upstream.headers.get('content-type') || 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    });
    response.end(responseBody);
  } catch (error) {
    if (response.headersSent || response.destroyed) return;
    if (error instanceof HttpError) {
      sendJson(response, error.statusCode, { error: { message: error.message } });
      return;
    }
    console.error('TMAP 프록시 요청 실패:', error.name || 'Error');
    const statusCode = error.name === 'TimeoutError' || error.name === 'AbortError' ? 504 : 502;
    sendJson(response, statusCode, { error: { message: 'TMAP 보행 경로 서비스에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.' } });
  }
}

const server = http.createServer((request, response) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, `http://${HOST}:${PORT}`).pathname);
  } catch {
    response.writeHead(400).end('Bad Request');
    return;
  }

  if (pathname === '/api/tmap/pedestrian') {
    void handleTmapProxy(request, response);
    return;
  }
  if (pathname.startsWith('/api/')) {
    response.writeHead(404, { 'Cache-Control': 'no-store' }).end('Not Found');
    return;
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end('Method Not Allowed');
    return;
  }

  if (pathname.split('/').some(segment => segment.startsWith('.'))) {
    response.writeHead(404, { 'Cache-Control': 'no-store' }).end('Not Found');
    return;
  }
  if (pathname === '/') pathname = '/index.html';
  const filePath = path.resolve(ROOT, `.${pathname}`);
  if (filePath !== ROOT && !filePath.startsWith(`${ROOT}${path.sep}`)) {
    response.writeHead(403).end('Forbidden');
    return;
  }

  fs.stat(filePath, (statError, stats) => {
    if (statError || !stats.isFile()) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not Found');
      return;
    }
    response.writeHead(200, {
      'Content-Type': CONTENT_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-cache'
    });
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    fs.createReadStream(filePath).pipe(response);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`쉬어갈곳 서버: http://${HOST}:${PORT}`);
  console.log(`TMAP 프록시: ${process.env.TMAP_APP_KEY?.trim() ? '서버 키 설정됨' : '.env의 TMAP_APP_KEY 미설정'}`);
});

server.on('error', error => {
  console.error('서버 시작 실패:', error.message);
  process.exitCode = 1;
});

gracefulShutdown();

function gracefulShutdown() {
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => server.close(() => process.exit(0)));
  }
}
