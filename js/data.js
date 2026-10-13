// OSM/Overpass 기반 휴식공간 검색 및 서버 프록시를 통한 TMAP 보행 라우팅.
const PLACE_SEARCH_ENDPOINT = '/api/tmap/search';
const placeSearchCache = new Map();
const TMAP_PEDESTRIAN_ENDPOINT = '/api/tmap/pedestrian';
const MAX_ROUTED_CANDIDATES = 12;
const ROUTE_CONCURRENCY = 3;
const ROUTE_CACHE_LIMIT = 24;
const routeCache = new Map();
let lastGeocodingRequestAt = 0;

// 공원 및 확실한 착석 태그 검색은 js/overpass.js가 수행합니다.
function buildOverpassQuery(lat, lng, radius = 1000) {
  return `[out:json][timeout:15];\n(\n nwr["amenity"="bench"](around:${radius},${lat},${lng});\n nwr["bench"="yes"](around:${radius},${lat},${lng});\n nwr["leisure"="gazebo"](around:${radius},${lat},${lng});\n nwr["amenity"="shelter"](around:${radius},${lat},${lng});\n nwr["leisure"="park"](around:${radius},${lat},${lng});\n nwr["leisure"="garden"](around:${radius},${lat},${lng});\n nwr["leisure"="playground"](around:${radius},${lat},${lng});\n nwr["landuse"="recreation_ground"](around:${radius},${lat},${lng});\n);\nout center tags;`;
}

function hasPositiveSeating(tags) {
  if (tags.bench === 'yes' || tags.picnic_table === 'yes') return true;
  const seats = Number.parseInt(tags.seats, 10);
  return Number.isFinite(seats) && seats > 0;
}

function osmElementToPlace(element) {
  const lat = Number(element.lat ?? element.center?.lat), lng = Number(element.lon ?? element.center?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  const tags = element.tags || {}, access = String(tags.access || '').toLowerCase();
  const fee = String(tags.fee || '').toLowerCase(), charge = String(tags.charge || '').toLowerCase();
  if (['private', 'no', 'customers'].includes(access)) return null;
  if (fee && !['no', 'false', '0'].includes(fee)) return null;
  if (charge && !['no', 'false', '0'].includes(charge)) return null;
  if (tags.bench === 'no' && tags.amenity === 'bench') return null;

  const isPark = tags.leisure === 'park' || tags.landuse === 'recreation_ground' || tags.leisure === 'garden' || tags.leisure === 'playground';
  let type, category, confirmed;

  if (isPark) {
    if (tags.leisure === 'playground') {
      type = '어린이공원·놀이터 쉼터';
    } else if (tags.leisure === 'garden') {
      type = '정원·쌈지공원';
    } else {
      type = '공원 · 착석시설 정보 확인 필요';
    }
    category = 'park';
    confirmed = false;
  } else if (tags.highway === 'bus_stop' && tags.bench === 'yes') {
    type = '의자 있는 버스정류장'; category = 'transit'; confirmed = true;
  } else if (tags.public_transport === 'platform' && tags.bench === 'yes') {
    type = '의자 있는 대중교통 대기공간'; category = 'transit'; confirmed = true;
  } else if (tags.highway === 'bus_stop' && (tags.shelter === 'yes' || tags.covered === 'yes')) {
    type = '쉘터형 버스정류장'; category = 'transit'; confirmed = true;
  } else if (tags.amenity === 'bench') {
    type = '벤치'; category = 'bench'; confirmed = true;
  } else if (tags.leisure === 'gazebo') {
    type = '정자·파고라'; category = 'shelter'; confirmed = true;
  } else if (tags.leisure === 'picnic_table' || tags.amenity === 'picnic_table') {
    type = '야외 테이블'; category = 'picnic'; confirmed = true;
  } else if (tags.amenity === 'shelter') {
    confirmed = tags.bench === 'yes' || hasPositiveSeating(tags) || tags.shelter_type === 'picnic_shelter' || tags.shelter_type === 'gazebo';
    type = confirmed ? '공공 쉼터·정자' : '쉼터 · 착석시설 정보 확인 필요';
    category = 'shelter';
  } else if (tags.tourism === 'picnic_site') {
    confirmed = hasPositiveSeating(tags);
    type = confirmed ? '피크닉 쉼터' : '피크닉 장소 · 착석시설 정보 확인 필요';
    category = 'picnic';
  } else if (tags.bench === 'yes') {
    type = '착석 가능 공간'; category = 'bench'; confirmed = true;
  } else {
    return null;
  }

  const details = {};
  if (isPark) {
    details.seating = '공원·녹지 후보이며 착석시설 정보는 확인 필요';
    details.locationNote = '공원 영역의 중심 좌표이며 개별 벤치·의자 위치는 현장에서 확인 필요합니다.';
  } else if (!confirmed) {
    details.seating = '휴식 장소 후보이며 착석시설 정보는 확인 필요';
  }
  if (tags.covered === 'yes' || tags.shelter === 'yes') details.covered = '지붕/그늘 표시 있음';
  else if (tags.covered === 'no') details.covered = '지붕 없음';
  if (tags.backrest === 'yes') details.backrest = '등받이 있음';
  else if (tags.backrest === 'no') details.backrest = '등받이 없음';
  if (tags.indoor === 'yes') details.indoor = '실내'; else if (tags.indoor === 'no') details.indoor = '실외';
  if (tags.wheelchair === 'yes' || tags.wheelchair === 'designated') details.wheelchair = '휠체어 접근 표시 있음';
  else if (tags.wheelchair === 'no') details.wheelchair = '휠체어 접근 어려움으로 표시';
  if (tags.name) details.name = tags.name;

  return {
    id: `osm-${element.type}-${element.id}`,
    name: tags.name || (isPark ? '이름 없는 공원·쉼터' : type),
    type, category,
    resultGroup: confirmed ? 'confirmed' : 'possible',
    seatingStatus: confirmed ? 'confirmed' : 'unknown',
    lat, lng, tags, details,
    source: 'OpenStreetMap', sources: ['OpenStreetMap']
  };
}

function rankPlaceSearchResults(results, query, biasLocation = null) {
  const normalize = value => String(value || '').normalize('NFKC').toLocaleLowerCase('ko-KR')
    .replace(/\[[^\]]*\]|\([^)]*\)/g, '').replace(/[\s\p{P}\p{S}]/gu, '');
  const keyword = normalize(query);
  const hasLocation = biasLocation && Number.isFinite(biasLocation.lat) && Number.isFinite(biasLocation.lng);
  return results.map((item, index) => {
    const name = normalize(item.name), address = normalize(item.label);
    const relevance = name === keyword ? 0 : name.startsWith(keyword) ? 1 : name.includes(keyword) ? 2 : address.includes(keyword) ? 3 : 4;
    const distanceMeters = hasLocation ? haversineMeters([biasLocation.lat, biasLocation.lng], [item.lat, item.lng]) : null;
    return { ...item, relevance, originalIndex: index, distanceMeters, distanceText: distanceMeters == null ? '' : formatRouteDistance(distanceMeters) };
  }).sort((a, b) => a.relevance - b.relevance || (hasLocation ? a.distanceMeters - b.distanceMeters : 0) || a.originalIndex - b.originalIndex)
    .map(({ relevance, originalIndex, ...item }) => item);
}

async function searchAddress(query, limit = 8, biasLocation = null, options = {}) {
  const keyword = query.normalize('NFKC').trim();
  const hasLocation = biasLocation && Number.isFinite(biasLocation.lat) && Number.isFinite(biasLocation.lng);
  const key = keyword + (hasLocation ? ':' + biasLocation.lat.toFixed(3) + ',' + biasLocation.lng.toFixed(3) : ':national');
  const cached = placeSearchCache.get(key);
  let results = cached && cached.expires > Date.now() ? cached.results : null;
  if (!results || options.refresh) {
    const params = { q: keyword };
    if (hasLocation) Object.assign(params, { lat: biasLocation.lat, lng: biasLocation.lng });
    const response = await fetch(PLACE_SEARCH_ENDPOINT + '?' + new URLSearchParams(params), { signal: options.signal || AbortSignal.timeout(15000) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error?.message || '장소 검색에 실패했습니다.');
    if (hasLocation && payload.nearbyStatus !== 'ok') {
      const error = new Error(payload.nearbyStatus === 'failed'
        ? '내 주변 검색이 실패했습니다. 다시 검색해 주세요.'
        : '검색 서버 업데이트가 필요합니다. 앱 서버를 재시작해 주세요.');
      error.code = 'NEARBY_SEARCH_UNAVAILABLE';
      throw error;
    }
    results = (payload.results || []).filter(item => Number.isFinite(item.lat) && Number.isFinite(item.lng));
    placeSearchCache.set(key, { results, expires: Date.now() + 60000 });
    if (placeSearchCache.size > 40) placeSearchCache.delete(placeSearchCache.keys().next().value);
  }
  return rankPlaceSearchResults(results, keyword, biasLocation).slice(0, limit);
}

function formatRouteDistance(meters) { return meters < 1000 ? `${Math.round(meters)}m` : `${(meters / 1000).toFixed(1)}km`; }
function formatRouteDuration(seconds) {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes}분`;
  const hours = Math.floor(minutes / 60), remaining = minutes % 60;
  return remaining ? `${hours}시간 ${remaining}분` : `${hours}시간`;
}
function haversineMeters(a, b) {
  const radians = degrees => degrees * Math.PI / 180;
  const lat1 = radians(a[0]), lat2 = radians(b[0]), deltaLat = lat2 - lat1, deltaLng = radians(b[1] - a[1]);
  const h = Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
function routeCacheKey(start, end) { return [start.lng, start.lat, end.lng, end.lat].map(value => Number(value).toFixed(6)).join(','); }
async function requestTmapRoute(start, end) {
  const cacheKey = routeCacheKey(start, end), cached = routeCache.get(cacheKey);
  if (cached) return cached;
  const routePromise = (async () => {
    const response = await fetch(TMAP_PEDESTRIAN_ENDPOINT, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ startX: start.lng, startY: start.lat, endX: end.lng, endY: end.lat, startName: start.name || '검색한 위치', endName: end.name || '휴식공간' })
    });
    const responseText = await response.text();
    let payload;
    try { payload = JSON.parse(responseText); }
    catch {
      const detail = responseText.trim().slice(0, 200);
      throw new Error(detail || `TMAP 오류 응답을 읽을 수 없습니다 (HTTP ${response.status}).`);
    }
    if (!response.ok) {
      const providerError = payload?.error;
      const providerMessage = providerError && typeof providerError === 'object'
        ? providerError.message
        : (typeof providerError === 'string' ? providerError : payload?.message);
      const providerCode = providerError && typeof providerError === 'object'
        ? providerError.code
        : (payload?.errorCode ?? payload?.code);
      const message = String(providerMessage || `TMAP HTTP ${response.status} 오류`).slice(0, 500);
      const error = new Error(message);
      error.code = providerCode ?? null;
      error.httpStatus = response.status;
      throw error;
    }
    return validateRouteGeometry(parseTmapRoute(payload));
  })();
  routeCache.set(cacheKey, routePromise);
  if (routeCache.size > ROUTE_CACHE_LIMIT) routeCache.delete(routeCache.keys().next().value);
  try { return await routePromise; }
  catch (error) { if (routeCache.get(cacheKey) === routePromise) routeCache.delete(cacheKey); throw error; }
}
function parseTmapRoute(payload) {
  const features = Array.isArray(payload?.features) ? payload.features : [];
  const lineFeatures = features.filter(feature => feature?.geometry?.type === 'LineString' && Array.isArray(feature.geometry.coordinates));
  const coordinates = [], steps = [];
  let distanceSum = 0, durationSum = 0;
  for (const feature of lineFeatures) {
    const segment = feature.geometry.coordinates.filter(point => Array.isArray(point) && point.length >= 2)
      .map(point => [Number(point[1]), Number(point[0])])
      .filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180);
    if (!segment.length) continue;
    let startIndex = coordinates.length;
    if (coordinates.length && Math.abs(coordinates.at(-1)[0] - segment[0][0]) < 1e-7 && Math.abs(coordinates.at(-1)[1] - segment[0][1]) < 1e-7) { startIndex = coordinates.length - 1; segment.shift(); }
    coordinates.push(...segment);
    const properties = feature.properties || {}, distance = Number(properties.distance || 0), duration = Number(properties.time || 0);
    if (Number.isFinite(distance) && distance > 0) distanceSum += distance;
    if (Number.isFinite(duration) && duration > 0) durationSum += duration;
    const instruction = String(properties.description || '').trim();
    if (instruction) steps.push({ instruction, distanceMeters: Number.isFinite(distance) ? distance : 0, durationSeconds: Number.isFinite(duration) ? duration : 0, startIndex, endIndex: Math.max(startIndex, coordinates.length - 1) });
  }
  const summary = features.map(feature => feature?.properties || {}).find(properties => Number.isFinite(Number(properties.totalDistance)) && Number.isFinite(Number(properties.totalTime))) || {};
  const totalDistance = Number(summary.totalDistance), totalDuration = Number(summary.totalTime);
  const distanceMeters = Number.isFinite(totalDistance) && totalDistance > 0 ? totalDistance : distanceSum;
  const durationSeconds = Number.isFinite(totalDuration) && totalDuration > 0 ? totalDuration : durationSum;
  if (coordinates.length < 2 || !Number.isFinite(distanceMeters) || distanceMeters <= 0 || !Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new Error('TMAP 응답에 유효한 경로·거리·시간 정보가 없습니다.');
  const cumulativeMeters = [0];
  for (let index = 1; index < coordinates.length; index += 1) cumulativeMeters.push(cumulativeMeters[index - 1] + haversineMeters(coordinates[index - 1], coordinates[index]));
  // TMAP 회전·횡단보도 지시는 Point에 들어 있고, LineString 설명은 도로명입니다.
  const maneuvers = [];
  let previousIndex = 0;
  for (const feature of features) {
    if (feature?.geometry?.type !== 'Point') continue;
    const point = feature.geometry.coordinates, instruction = String(feature.properties?.description || '').trim();
    if (!Array.isArray(point) || !Number.isFinite(Number(point[0])) || !Number.isFinite(Number(point[1])) || !instruction) continue;
    let nearestIndex = previousIndex, nearestDistance = Infinity;
    for (let index = previousIndex; index < coordinates.length; index += 1) {
      const distance = haversineMeters([Number(point[1]), Number(point[0])], coordinates[index]);
      if (distance < nearestDistance) { nearestDistance = distance; nearestIndex = index; }
      if (distance < 1) break;
    }
    if (nearestDistance > 50) continue;
    previousIndex = nearestIndex;
    maneuvers.push({ instruction, startIndex: nearestIndex, instructionMeters: cumulativeMeters[nearestIndex], isManeuver: true });
  }
  const guidanceSteps = maneuvers.length ? maneuvers.map((step, index) => {
    const endIndex = maneuvers[index + 1]?.startIndex ?? coordinates.length - 1;
    const stepDistance = Math.max(0, cumulativeMeters[endIndex] - step.instructionMeters);
    return { ...step, endIndex, distanceMeters: stepDistance, durationSeconds: distanceMeters > 0 ? durationSeconds * stepDistance / distanceMeters : 0 };
  }) : steps;
  return { distanceMeters, durationSeconds, coordinates, cumulativeMeters, steps: guidanceSteps };
}

function validateRouteGeometry(route) {
  // TMAP 거리보다 경로 좌표의 실제 길이가 지나치게 길면, 떨어진 선분이나 이상한
  // 좌표가 bounds를 키워 지도가 과도하게 축소될 수 있습니다. 그런 경로는 표시하지 않습니다.
  const geometryLength = route.cumulativeMeters[route.cumulativeMeters.length - 1] || 0;
  const maximumPlausibleLength = Math.max(route.distanceMeters * 2.5, route.distanceMeters + 300);
  if (!Number.isFinite(geometryLength) || geometryLength > maximumPlausibleLength) {
    throw new Error('TMAP 경로 좌표와 표시 거리가 일치하지 않아 경로를 안전하게 표시할 수 없습니다. 경로를 다시 조회해 주세요.');
  }
  return route;
}

async function addWalkingRoutes(places, origin, options = {}) {
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
  const candidates = [...places].map(place => ({ place, internalDistance: haversineMeters([origin.lat, origin.lng], [place.lat, place.lng]) }))
    .sort((a, b) => a.internalDistance - b.internalDistance).slice(0, MAX_ROUTED_CANDIDATES).map(item => item.place);
  const results = new Array(candidates.length); let nextIndex = 0, completed = 0;
  async function worker() {
    while (nextIndex < candidates.length) {
      const index = nextIndex++, place = candidates[index];
      try {
        const route = await requestTmapRoute(origin, { lat: place.lat, lng: place.lng, name: place.name });
        results[index] = { ...place, routeDistanceMeters: route.distanceMeters, routeDurationSeconds: route.durationSeconds,
          routeDistanceText: formatRouteDistance(route.distanceMeters), routeDurationText: formatRouteDuration(route.durationSeconds), routeStatus: 'ok' };
      } catch (error) {
        console.warn(`TMAP 보행 경로 계산 실패 (${place.id}):`, error.message);
        results[index] = { ...place, routeStatus: 'error', routeError: error.message || 'TMAP 보행 경로 요청이 실패했습니다.' };
      } finally { completed += 1; onProgress(completed, candidates.length); }
    }
  }
  await Promise.all(Array.from({ length: Math.min(ROUTE_CONCURRENCY, candidates.length) }, () => worker()));
  return results.sort((a, b) => a.routeStatus !== 'ok' ? (b.routeStatus === 'ok' ? 1 : 0) : b.routeStatus !== 'ok' ? -1 : a.routeDistanceMeters - b.routeDistanceMeters);
}
window.Data = {
  buildOverpassQuery, osmElementToPlace, fetchPlacesFromOSM: null, searchAddress, addWalkingRoutes,
  requestWalkingRoute: requestTmapRoute, formatRouteDistance, formatRouteDuration
};
