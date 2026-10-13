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


const parkCache = new Map();
async function handleNearbyParks(request, response) {
  if (request.method !== 'GET') { response.writeHead(405, { Allow: 'GET' }).end(); return; }
  const params = new URL(request.url, 'http://localhost').searchParams;
  const lat = params.get('lat'), lng = params.get('lng'), radius = Number(params.get('radius') || 1000);
  if (!isLatitude(lat) || !isCoordinate(lng) || !Number.isFinite(radius) || radius < 100 || radius > 2000) {
    sendJson(response, 400, { error: { message: '검색 위치와 반경이 올바르지 않습니다.' } }); return;
  }
  const key = [Number(lat).toFixed(5), Number(lng).toFixed(5), radius].join(',');
  const cached = parkCache.get(key);
  if (cached && cached.expires > Date.now()) { sendJson(response, 200, { places: cached.places }); return; }
  if (isRateLimited(request)) { sendJson(response, 429, { error: { message: '잠시 후 다시 검색해 주세요.' } }); return; }
  const appKey = process.env.TMAP_APP_KEY?.trim();
  if (!appKey) { sendJson(response, 503, { error: { message: 'TMAP 서버 키가 설정되지 않았습니다.' } }); return; }
  try {
    const url = new URL('https://apis.openapi.sk.com/tmap/pois/search/around');
    url.search = new URLSearchParams({ version: '1', centerLat: String(lat), centerLon: String(lng), categories: '공원', count: '100', radius: String(Math.ceil(radius / 1000)), reqCoordType: 'WGS84GEO', resCoordType: 'WGS84GEO', sort: 'distance' });
    const upstream = await fetch(url, { headers: { appKey, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
    const text = await upstream.text();
    if (!upstream.ok) { const error = extractTmapError(text, upstream, appKey); sendJson(response, upstream.status, { error }); return; }
    const payload = JSON.parse(text);
    const records = payload.searchPoiInfo?.pois?.poi || [];
    const places = (Array.isArray(records) ? records : [records]).map(poi => {
      const validPoint = (y, x) => Number(y) > 0 && isLatitude(y) && Number(x) > 0 && isCoordinate(x);
      const hasEntrance = validPoint(poi.frontLat, poi.frontLon);
      const y = Number(hasEntrance ? poi.frontLat : poi.noorLat), x = Number(hasEntrance ? poi.frontLon : poi.noorLon);
      if (!validPoint(y, x)) return null;
      const rad = value => value * Math.PI / 180;
      const a = Math.sin(rad(y - Number(lat)) / 2) ** 2 + Math.cos(rad(Number(lat))) * Math.cos(rad(y)) * Math.sin(rad(x - Number(lng)) / 2) ** 2;
      if (6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) > radius) return null;
      return { id: 'tmap-park-' + poi.id, name: String(poi.name || '이름 없는 공원'), type: '공원 · 착석시설 정보 확인 필요', category: 'park', resultGroup: 'possible', seatingStatus: 'unknown', lat: y, lng: x, source: 'TMAP 장소 검색', sources: ['TMAP 장소 검색'], details: { seating: '착석시설과 무료 이용·개방 여부는 현장 확인 필요', locationNote: hasEntrance ? '장소 데이터의 입구 좌표이며 개별 벤치 위치가 아닙니다.' : '장소 대표 좌표이며 입구·벤치 위치는 현장에서 확인 필요합니다.' } };
    }).filter(Boolean);
    parkCache.set(key, { places, expires: Date.now() + 300000 });
    if (parkCache.size > 64) parkCache.delete(parkCache.keys().next().value);
    sendJson(response, 200, { places });
  } catch (error) { sendJson(response, 502, { error: { message: '주변 공원 검색 서버에 연결하지 못했습니다.' } }); }
}


const placeSearchCache = new Map(), pendingPlaceSearches = new Map();
async function handlePlaceSearch(request, response) {
  if (request.method !== 'GET') { response.writeHead(405, { Allow: 'GET' }).end(); return; }
  const params = new URL(request.url, 'http://localhost').searchParams;
  const query = String(params.get('q') || '').normalize('NFKC').trim();
  if (!query || query.length > 80 || /[\u0000-\u001f\u007f]/.test(query)) { sendJson(response, 400, { error: { message: '검색어를 1~80자로 입력해 주세요.' } }); return; }
  const location = isLatitude(params.get('lat')) && isCoordinate(params.get('lng')) ? { lat: Number(params.get('lat')), lng: Number(params.get('lng')) } : null;
  const cacheKey = query + (location ? ':' + location.lat.toFixed(3) + ',' + location.lng.toFixed(3) : ':national');
  const cached = placeSearchCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) { sendJson(response, 200, cached.payload); return; }
  const appKey = process.env.TMAP_APP_KEY?.trim();
  if (!appKey) { sendJson(response, 503, { error: { message: '장소 검색용 TMAP 서버 키가 설정되지 않았습니다.' } }); return; }
  if (!pendingPlaceSearches.has(cacheKey)) {
    if (isRateLimited(request)) { sendJson(response, 429, { error: { message: '검색 요청이 많습니다. 잠시 후 다시 검색해 주세요.' } }); return; }
    const promise = (async () => {
      async function fetchMatches(nearby) {
        const url = new URL('https://apis.openapi.sk.com/tmap/pois');
        const search = { version: '1', searchKeyword: query, searchType: 'all', searchtypCd: nearby ? 'R' : 'A', count: '200', page: '1', reqCoordType: 'WGS84GEO', resCoordType: 'WGS84GEO', multiPoint: 'N', poiGroupYn: 'N' };
        if (nearby) Object.assign(search, { centerLat: String(location.lat), centerLon: String(location.lng), radius: '33' });
        url.search = new URLSearchParams(search);
        const upstream = await fetch(url, { headers: { appKey, Accept: 'application/json' }, signal: AbortSignal.timeout(12000) });
        const text = await upstream.text();
        if (!upstream.ok) { const error = extractTmapError(text, upstream, appKey); throw new HttpError(upstream.status, error.message); }
        const payload = JSON.parse(text);
        const raw = payload.searchPoiInfo?.pois?.poi || [];
        return Array.isArray(raw) ? raw : [raw];
      }
      const settled = await Promise.allSettled(location ? [fetchMatches(true), fetchMatches(false)] : [fetchMatches(false)]);
      if (settled.every(result => result.status === 'rejected')) throw settled[0].reason;
      const raw = settled.flatMap(result => result.status === 'fulfilled' ? result.value : []);
      const seen = new Set();
      const results = (Array.isArray(raw) ? raw : [raw]).map(poi => {
        const valid = (y, x) => Number(y) > 0 && isLatitude(y) && Number(x) > 0 && isCoordinate(x);
        const entrance = valid(poi.frontLat, poi.frontLon);
        const lat = Number(entrance ? poi.frontLat : poi.noorLat), lng = Number(entrance ? poi.frontLon : poi.noorLon);
        if (!valid(lat, lng)) return null;
        const id = String(poi.id || '') + ':' + String(poi.navSeq || '0');
        if (seen.has(id)) return null;
        seen.add(id);
        const name = String(poi.name || query);
        const address = [poi.upperAddrName, poi.middleAddrName, poi.lowerAddrName, poi.roadName, poi.firstBuildNo].filter(Boolean).join(' ');
        return { id, name, label: address || name, lat, lng, type: String(poi.lowerBizName || poi.middleBizName || ''), source: 'TMAP 장소 검색' };
      }).filter(Boolean);
      const nearbyStatus = !location ? 'not-requested' : settled[0].status === 'fulfilled' ? 'ok' : 'failed';
      const responsePayload = { results, nearbyStatus, rankingVersion: 2 };
      // 주변 검색 실패는 정상 위치 결과로 저장하지 않습니다. 다음 검색에서 재시도합니다.
      if (nearbyStatus !== 'failed') placeSearchCache.set(cacheKey, { payload: responsePayload, expires: Date.now() + 600000 });
      if (placeSearchCache.size > 128) placeSearchCache.delete(placeSearchCache.keys().next().value);
      return responsePayload;
    })();
    pendingPlaceSearches.set(cacheKey, promise);
  }
  const pending = pendingPlaceSearches.get(cacheKey);
  try { sendJson(response, 200, await pending); }
  catch (error) { sendJson(response, error instanceof HttpError ? error.statusCode : 502, { error: { message: error instanceof HttpError ? error.message : '장소 검색 서버에 연결하지 못했습니다. 다시 검색해 주세요.' } }); }
  finally { if (pendingPlaceSearches.get(cacheKey) === pending) pendingPlaceSearches.delete(cacheKey); }
}

const server = http.createServer((request, response) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, `http://${HOST}:${PORT}`).pathname);
  } catch {
    response.writeHead(400).end('Bad Request');
    return;
  }

  if (pathname === '/api/tmap/search') { void handlePlaceSearch(request, response); return; }
  if (pathname === '/api/tmap/parks') { void handleNearbyParks(request, response); return; }
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
