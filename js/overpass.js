// Overpass: 독립 서브쿼리 병렬 처리 및 기본 1km 검색 (사용자 확장 지원)
(() => {
  const ENDPOINTS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter'
  ];
  const DEFAULT_RADIUS = 1000, REQUEST_TIMEOUT_MS = 6_000, MAX_RESULTS = 100;
  
  function queryFor(lat, lng, radius, kind = 'core') {
    const around = `(around:${radius},${lat},${lng})`;
    const tags = kind === 'core'
      ? [['amenity','bench'],['bench','yes'],['leisure','gazebo'],['amenity','shelter','bench','yes'],['amenity','shelter','seats','*'],['amenity','shelter','shelter_type','picnic_shelter'],['leisure','picnic_table'],['amenity','picnic_table']]
      : kind === 'parks' ? [['leisure','park'],['landuse','recreation_ground']]
        : [['highway','bus_stop','bench','yes'],['public_transport','platform','bench','yes'],['tourism','picnic_site']];
    const statements = tags.map(([key,value,extraKey,extraValue]) => `nwr["${key}"="${value}"]${extraKey ? `["${extraKey}"${extraValue === '*' ? '' : `="${extraValue}"`}]` : ''}${around};`);
    return `[out:json][timeout:6];\n(\n${statements.join('\n')}\n);\nout center tags;`;
  }
  
  const emit = (name, detail = {}) => window.dispatchEvent(new CustomEvent(name, { detail }));
  
  async function request(lat, lng, radius, kind) {
    const body = `data=${encodeURIComponent(queryFor(lat,lng,radius,kind))}`;
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
        console.info(`[Overpass] 반경 ${radius}m ${kind} HTTP ${status}, ${Math.round(performance.now() - startedAt)}ms, ${places.length}건`);
        return places;
      } catch (error) {
        console.warn(`[Overpass] 반경 ${radius}m ${kind} ${status === null ? 'HTTP 상태 없음' : `HTTP ${status}`}, ${controller.signal.aborted ? 'timeout' : error.message || 'request failed'}`);
      } finally {
        window.clearTimeout(timeout);
      }
    }
    return [];
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
      if (index === undefined) index = places.findIndex(other => distanceMeters(other, place) <= 40 && namesMatch(other, place));
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
  
  function trimPlaces(places) {
    const confirmed = places.filter(place => place.resultGroup !== 'possible');
    const possible = places.filter(place => place.resultGroup === 'possible');
    const transit = confirmed.filter(place => place.category === 'transit');
    const nonTransit = confirmed.filter(place => place.category !== 'transit');
    const selected = [...nonTransit.slice(0, 60), ...possible.slice(0, 35)];
    const transitLimit = selected.length ? Math.min(12, Math.max(1, Math.floor(nonTransit.length / 3))) : 12;
    selected.push(...transit.slice(0, transitLimit));
    return selected.slice(0, MAX_RESULTS);
  }
  
  async function fetchPlacesFromOSM(lat, lng, options = {}) {
    const radius = Number(options.radiusMeters) || DEFAULT_RADIUS;
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
    const onUpdate = typeof options.onUpdate === 'function' ? options.onUpdate : () => {};
    
    let accumulated = [];
    emit('overpass:search-start', { lat, lng, radiusMeters: radius });
    onProgress(radius);

    const snapshot = () => trimPlaces(accumulated);
    const publish = (queryKind) => {
      const places = snapshot();
      if (!places.length) return;
      const update = { lat, lng, places, radiusMeters: radius, query: queryKind, isDone: false };
      onUpdate(update);
      emit('overpass:results', update);
    };

    try {
      // 동일 반경 내 독립적인 서브쿼리들(core, parks, auxiliary)을 병렬로 동시 요청
      const subQueries = [
        { kind: 'core' },
        { kind: 'parks' },
        { kind: 'auxiliary' }
      ];

      const promises = subQueries.map(async ({ kind }) => {
        try {
          const places = await request(lat, lng, radius, kind);
          if (places && places.length) {
            accumulated = mergePlaces(accumulated, places);
            publish(kind);
          }
        } catch (error) {
          console.warn(`[Overpass] ${radius}m ${kind} 병렬 요청 오류:`, error);
        }
      });

      await Promise.all(promises);

      const finalPlaces = snapshot();
      const doneUpdate = { lat, lng, places: finalPlaces, radiusMeters: radius, isDone: true };
      onUpdate(doneUpdate);
      emit('overpass:results', doneUpdate);

      return { places: finalPlaces, radiusMeters: radius };
    } finally {
      emit('overpass:search-done', { lat, lng, radiusMeters: radius });
    }
  }

  Data.buildOverpassQuery = queryFor;
  Data.fetchPlacesFromOSM = fetchPlacesFromOSM;
})();
