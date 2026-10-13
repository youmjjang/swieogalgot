// Overpass: 점진적 병렬 쿼리(공원/쉼터 + 벤치/편의시설) 및 첫 결과 수신 즉시 UI 개방
(() => {
  const ENDPOINTS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
    'https://overpass.private.coffee/api/interpreter'
  ];
  const DEFAULT_RADIUS = 1000, REQUEST_TIMEOUT_MS = 6_000, MAX_RESULTS = 100;

  // 1. 공원, 정원, 쉼터 등 주요 휴식 구역 쿼리 (응답이 빠르고 확실한 장소들)
  function buildParksAndSheltersQuery(lat, lng, radius) {
    const around = `(around:${radius},${lat},${lng})`;
    return `[out:json][timeout:5];
(
  nwr["leisure"="park"]${around};
  nwr["landuse"="recreation_ground"]${around};
  nwr["leisure"="garden"]${around};
  nwr["leisure"="playground"]${around};
  node["leisure"="gazebo"]${around};
  nwr["amenity"="shelter"]${around};
);
out center tags;`;
  }

  // 2. 벤치, 의자 있는 정류장, 야외 테이블 등 세부 착석 시설 쿼리
  function buildSeatingQuery(lat, lng, radius) {
    const around = `(around:${radius},${lat},${lng})`;
    return `[out:json][timeout:5];
(
  node["amenity"="bench"]${around};
  node["bench"="yes"]${around};
  node["leisure"="picnic_table"]${around};
  node["tourism"="picnic_site"]${around};
  node["highway"="bus_stop"]["bench"="yes"]${around};
  node["public_transport"="platform"]["bench"="yes"]${around};
);
out center tags;`;
  }

  const emit = (name, detail = {}) => window.dispatchEvent(new CustomEvent(name, { detail }));

  async function executeSubQuery(queryName, queryText) {
    const body = `data=${encodeURIComponent(queryText)}`;
    for (let index = 0; index < ENDPOINTS.length; index += 1) {
      const startedAt = performance.now();
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      let status = null;
      try {
        const response = await fetch(ENDPOINTS[index], {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
          body,
          signal: controller.signal
        });
        status = response.status;
        if (!response.ok) throw new Error(`HTTP ${status}`);
        const payload = await response.json();
        if (payload.remark && !payload.elements?.length) throw new Error('Overpass query error');
        const places = (payload.elements || []).map(Data.osmElementToPlace).filter(Boolean);
        console.info(`[Overpass:${queryName}] HTTP ${status}, ${Math.round(performance.now() - startedAt)}ms, ${places.length}건`);
        return { success: true, places, endpoint: ENDPOINTS[index] };
      } catch (error) {
        console.warn(`[Overpass:${queryName}] 엔드포인트 ${ENDPOINTS[index]} 실패 (${status === null ? 'HTTP 없음' : `HTTP ${status}`}, ${controller.signal.aborted ? 'timeout' : error.message || 'error'})`);
      } finally {
        window.clearTimeout(timeout);
      }
    }
    return { success: false, places: [], error: new Error(`${queryName} 요청 실패`) };
  }

  function distanceMeters(a, b) {
    const rad = value => value * Math.PI / 180;
    const lat1 = rad(a.lat), lat2 = rad(b.lat), dLat = lat2 - lat1, dLng = rad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }

  function normalizedName(place) {
    return String(place.name || '').normalize('NFKC').toLocaleLowerCase('ko-KR').replace(/\s+/g, '').replace(/[\p{P}\p{S}]/gu, '');
  }

  function namesMatch(first, second) {
    const a = normalizedName(first), b = normalizedName(second);
    return Boolean(a && b && (a === b || (Math.min(a.length, b.length) >= 4 && (a.includes(b) || b.includes(a)))));
  }

  function mergePlaces(existing, incoming) {
    const places = [...existing], byId = new Map(places.map((place, index) => [place.id, index]));
    for (const place of incoming) {
      let index = byId.get(place.id);
      if (index === undefined) index = places.findIndex(other => !(String(other.id).startsWith('osm-') && String(place.id).startsWith('osm-')) && distanceMeters(other, place) <= 40 && namesMatch(other, place));
      if (index < 0 || index === undefined) {
        byId.set(place.id, places.length);
        places.push(place);
        continue;
      }
      const previous = places[index];
      const sources = [...new Set([...(previous.sources || [previous.source]), ...(place.sources || [place.source])])];
      const preferred = place.resultGroup === 'confirmed' && previous.resultGroup !== 'confirmed' ? place : previous;
      const other = preferred === previous ? place : previous;
      places[index] = {
        ...other,
        ...preferred,
        details: { ...(other.details || {}), ...(preferred.details || {}) },
        tags: { ...(other.tags || {}), ...(preferred.tags || {}) },
        sources,
        source: sources.join(' · ')
      };
      byId.set(place.id, index);
    }
    return places;
  }

  // 착석 확인 여부로 결과를 나누거나 우선 배정하지 않고, 검색 위치에서 가까운 순으로
  // 한 목록의 최대 결과 수만 유지합니다. 앱 화면에서는 계산된 도보거리를 우선 반영합니다.
  function trimPlaces(places, origin) {
    return places.map((place, index) => {
      const hasCoordinates = Number.isFinite(place.lat) && Number.isFinite(place.lng);
      const distance = origin && hasCoordinates ? distanceMeters(origin, place) : Infinity;
      return { place, index, distance };
    }).sort((a, b) => a.distance - b.distance || a.index - b.index)
      .slice(0, MAX_RESULTS)
      .map(item => item.place);
  }

  async function fetchPlacesFromOSM(lat, lng, options = {}) {
    const radius = Number(options.radiusMeters) || DEFAULT_RADIUS;
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
    const onUpdate = typeof options.onUpdate === 'function' ? options.onUpdate : () => {};
    const origin = { lat, lng };

    emit('overpass:search-start', { lat, lng, radiusMeters: radius });
    onProgress(radius);

    let collectedPlaces = [];
    let completedCount = 0;
    let failedCount = 0;
    const totalSubQueries = 2;

    const queries = [
      { name: '공원·쉼터', query: buildParksAndSheltersQuery(lat, lng, radius) },
      { name: '벤치·착석시설', query: buildSeatingQuery(lat, lng, radius) }
    ];

    // 병렬로 두 쿼리를 실행하되, 어느 하나라도 먼저 완료되면 즉시 UI에 1차 결과 전달
    const queryPromises = queries.map(async item => {
      const result = await executeSubQuery(item.name, item.query);
      completedCount += 1;
      if (result.success) {
        if (result.places.length > 0) {
          collectedPlaces = mergePlaces(collectedPlaces, result.places);
          const trimmed = trimPlaces(collectedPlaces, origin);
          const isDone = completedCount === totalSubQueries;
          onUpdate({
            lat, lng,
            places: trimmed,
            radiusMeters: radius,
            isDone,
            hasFirstResult: true,
            hasPartialFailure: failedCount > 0,
            allFailed: false
          });
        }
      } else {
        failedCount += 1;
      }
    });

    await Promise.all(queryPromises);

    const allFailed = failedCount === totalSubQueries;
    const hasPartialFailure = failedCount > 0 && !allFailed;
    const finalPlaces = trimPlaces(collectedPlaces, origin);

    const doneUpdate = {
      lat, lng,
      places: finalPlaces,
      radiusMeters: radius,
      isDone: true,
      hasPartialFailure,
      allFailed
    };

    onUpdate(doneUpdate);
    emit('overpass:results', doneUpdate);
    emit('overpass:search-done', { lat, lng, radiusMeters: radius });

    if (allFailed && finalPlaces.length === 0) {
      const err = new Error('모든 Overpass 엔드포인트 요청에 실패했습니다.');
      err.allFailed = true;
      throw err;
    }

    return { places: finalPlaces, radiusMeters: radius, hasPartialFailure, allFailed };
  }

  Data.buildOverpassQuery = (lat, lng, radius) => buildParksAndSheltersQuery(lat, lng, radius);
  Data.fetchPlacesFromOSM = fetchPlacesFromOSM;
})();
