// 국내 공공데이터 어댑터 확장 지점. 실제 데이터셋은 출처/좌표계를 확인한 뒤 등록합니다.
(() => {
  const osmSearch = window.Data.fetchPlacesFromOSM.bind(window.Data);
  const providers = new Map();
  const DEDUPE_METERS = 40;

  function registerPublicPlaceProvider(provider) {
    if (!provider || typeof provider.id !== 'string' || !provider.id.trim() ||
        typeof provider.fetch !== 'function' || typeof provider.normalize !== 'function') {
      throw new TypeError('공공데이터 제공자는 id, fetch(context), normalize(record)를 가져야 합니다.');
    }
    if (providers.has(provider.id)) throw new Error(`이미 등록된 데이터 제공자입니다: ${provider.id}`);
    providers.set(provider.id, provider);
  }

  function haversineMeters(a, b) {
    const radians = value => value * Math.PI / 180;
    const lat1 = radians(a.lat), lat2 = radians(b.lat);
    const dLat = lat2 - lat1, dLng = radians(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }

  function normalizedName(place) {
    return String(place.name || '').normalize('NFKC').toLocaleLowerCase('ko-KR')
      .replace(/\s+/g, '').replace(/[\p{P}\p{S}]/gu, '');
  }

  function namesMatch(first, second) {
    const a = normalizedName(first), b = normalizedName(second);
    return Boolean(a && b && (a === b || (Math.min(a.length, b.length) >= 4 && (a.includes(b) || b.includes(a)))));
  }

  function mergeSameId(existing, place) {
    const sources = [...new Set([...(existing.sources || [existing.source]), ...(place.sources || [place.source])])];
    const preferred = place.resultGroup === 'confirmed' && existing.resultGroup !== 'confirmed' ? place : existing;
    const other = preferred === existing ? place : existing;
    return {
      ...other, ...preferred,
      details: { ...(other.details || {}), ...(preferred.details || {}) },
      sources, source: sources.join(' · '),
      tags: { ...(other.tags || {}), ...(preferred.tags || {}) }
    };
  }

  function normalizePublicPlace(record, provider) {
    const place = provider.normalize(record);
    if (!place || typeof place !== 'object') return null;
    // normalize()는 원본 좌표계를 WGS84 위도·경도로 변환한 표준 객체를 반환해야 합니다.
    const lat = Number(place.lat), lng = Number(place.lng);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) return null;
    const confirmed = place.resultGroup === 'confirmed' || place.seatingStatus === 'confirmed';
    const sourceName = String(provider.source || provider.name || provider.id).trim();
    return {
      ...place,
      id: String(place.id || `${provider.id}-${lat.toFixed(6)}-${lng.toFixed(6)}`),
      name: String(place.name || '이름 없는 공공 휴식공간'),
      type: String(place.type || '공공 휴식공간 · 정보 확인 필요'),
      category: place.category || 'public',
      resultGroup: confirmed ? 'confirmed' : 'possible',
      seatingStatus: confirmed ? 'confirmed' : 'unknown', lat, lng,
      source: sourceName,
      sources: [...new Set([...(Array.isArray(place.sources) ? place.sources : []), sourceName])]
    };
  }

  function deduplicatePlaces(input) {
    const unique = [], ids = new Map();
    for (const place of input) {
      if (ids.has(place.id)) {
        const index = ids.get(place.id); unique[index] = mergeSameId(unique[index], place); continue;
      }
      const duplicateIndex = unique.findIndex(existing => haversineMeters(existing, place) <= DEDUPE_METERS && namesMatch(existing, place));
      if (duplicateIndex < 0) {
        ids.set(place.id, unique.length);
        unique.push({ ...place, sources: [...new Set(place.sources || [place.source])] });
      } else {
        unique[duplicateIndex] = mergeSameId(unique[duplicateIndex], place);
        ids.set(place.id, duplicateIndex);
      }
    }
    return unique;
  }

  async function fetchPublicPlaces(context) {
    const registered = [...providers.values()];
    const settled = await Promise.allSettled(registered.map(async provider => {
      const records = await provider.fetch(context);
      if (!Array.isArray(records)) throw new TypeError(`${provider.id} fetch 결과는 배열이어야 합니다.`);
      return records.map(record => normalizePublicPlace(record, provider)).filter(Boolean);
    }));
    const places = [];
    settled.forEach((result, index) => {
      if (result.status === 'fulfilled') places.push(...result.value);
      else console.warn(`[공공데이터] ${registered[index].id} 검색 실패; 다른 출처 결과를 유지합니다.`);
    });
    return places;
  }

  async function fetchPlaces(lat, lng, options = {}) {
    const osm = await osmSearch(lat, lng, options);
    const publicPlaces = await fetchPublicPlaces({ lat, lng, radiusMeters: osm.radiusMeters, coordinateSystem: 'WGS84' });
    const places = deduplicatePlaces([...osm.places, ...publicPlaces]);
    const update = { lat, lng, places, radiusMeters: osm.radiusMeters, query: 'osm+public' };
    if (places.length) {
      options.onUpdate?.(update);
      window.dispatchEvent(new CustomEvent('overpass:results', { detail: update }));
    }
    return { ...osm, places };
  }

  window.Data.registerPublicPlaceProvider = registerPublicPlaceProvider;
  window.Data.fetchPublicPlaces = fetchPublicPlaces;
  window.Data.deduplicatePlaces = deduplicatePlaces;
  window.Data.fetchPlacesFromOSM = fetchPlaces;
})();
