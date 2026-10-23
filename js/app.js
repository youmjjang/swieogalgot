// 쉬어갈곳 앱 진입점: 상태, 검색, 지도, 목록, 상세 및 GPS 실시간 안내를 한곳에서 관리합니다.
const appState = {
  userLocation: null,
  userLocationAccuracy: null,
  userWatchId: null,
  searchOrigin: null,
  searchLabel: '선택한 위치',
  currentRadius: 1000,
  isSearching: false,
  backgroundSearching: false,
  searchOriginKind: 'address',
  enrichedPlaceIds: new Set(),
  searchError: null,
  places: [],
  map: null,
  markers: [],
  userMarker: null,
  searchOriginMarker: null,
  userAccuracyCircle: null,
  navigationMarker: null,
  routeLine: null,
  routeInfo: null,
  selectedPlace: null,
  routeProgressMeters: 0,
  navigationActive: false,
  navigationPosition: null,
  followNavigation: true,
  rerouteInProgress: false,
  lastRerouteAt: 0,
  locationWatchId: null,
  searchToken: 0,
  routeToken: 0,
  suggestionDebounceTimer: null,
  activeSuggestionIndex: -1,
  currentSuggestions: [],
  suggestionQuery: '',
  suggestionToken: 0,
  suggestionController: null,
  suggestionLocationKey: null,
  composingSearch: false,
  view: 'map',
  routeMode: 'search',
  routeViewerActive: false,
  searchRouteSnapshot: null,
  lastRouteStart: null
};
window.appState = appState;

const elements = {
  searchForm: document.getElementById('searchForm'),
  searchInput: document.getElementById('searchInput'),
  searchSuggestions: document.getElementById('searchSuggestions'),
  btnCurrentLocation: document.getElementById('btnCurrentLocation'),
  btnRecenter: document.getElementById('btnRecenter'),
  btnFollowNavigation: document.getElementById('btnFollowNavigation'),
  locationHint: document.getElementById('locationHint'),
  mainContent: document.getElementById('mainContent'),
  tabMap: document.getElementById('tabMap'),
  tabList: document.getElementById('tabList'),
  tabCount: document.getElementById('tabCount'),
  mapPanel: document.getElementById('mapPanel'),
  listPanel: document.getElementById('listPanel'),
  placesList: document.getElementById('placesList'),
  emptyState: document.getElementById('emptyState'),
  resultsCount: document.getElementById('resultsCount'),
  expandSearchContainer: document.getElementById('expandSearchContainer'),
  btnExpandSearch: document.getElementById('btnExpandSearch'),
  expandSearchText: document.getElementById('expandSearchText'),
  bottomSheet: document.getElementById('bottomSheet'),
  sheetTitle: document.getElementById('sheetTitle'),
  sheetBody: document.getElementById('sheetBody'),
  sheetBackdrop: document.getElementById('sheetBackdrop'),
  btnCloseSheet: document.getElementById('btnCloseSheet'),
  navPanel: document.getElementById('navPanel'),
  navInstruction: document.getElementById('navInstruction'),
  navDistance: document.getElementById('navDistance'),
  navRemaining: document.getElementById('navRemaining'),
  navStatus: document.getElementById('navStatus'),
  btnSearchRouteStart: document.getElementById('btnSearchRouteStart'),
  btnPreviewRoute: document.getElementById('btnPreviewRoute'),
  btnStartNavigation: document.getElementById('btnStartNavigation'),
  btnStopNavigation: document.getElementById('btnStopNavigation'),
  btnRecalculateRoute: document.getElementById('btnRecalculateRoute'),
  btnUserLocation: document.getElementById('btnUserLocation')
};
window.appElements = elements;

function getMap() {
  if (!appState.map) initializeMap();
  return appState.map;
}

function initializeMap() {
  const mapElement = document.getElementById('map');
  if (!mapElement || !window.L) {
    if (elements.locationHint) elements.locationHint.textContent = '지도를 불러오지 못했습니다. 네트워크 연결을 확인해 주세요.';
    return null;
  }
  if (appState.map) return appState.map;
  const map = L.map(mapElement, { zoomControl: true, preferCanvas: true }).setView([36.5, 127.8], 7);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }).addTo(map);
  appState.map = map;
  map.on('click', () => hideSuggestions());
  map.on('dragstart', () => {
    if (!appState.navigationActive) return;
    appState.followNavigation = false;
    updateNavigationControls();
  });
  return map;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function formatLocationAccuracy(meters) {
  if (!Number.isFinite(Number(meters))) return '알 수 없음';
  const value = Number(meters);
  return value >= 1000 ? `${(value / 1000).toFixed(1)}km` : `${Math.round(value)}m`;
}

function invalidateVisibleMap() {
  if (!appState.map) return;
  window.requestAnimationFrame(() => appState.map?.invalidateSize({ animate: false, pan: true }));
}

function waitForAnimationFrame() {
  return new Promise(resolve => window.requestAnimationFrame(resolve));
}

function waitForMapContainerSize(mapElement, searchToken, timeoutMs = 1000) {
  return new Promise(resolve => {
    let settled = false;
    let frameId = null;
    const timeoutId = window.setTimeout(() => finish(false), timeoutMs);

    function finish(isReady) {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      if (frameId !== null) window.cancelAnimationFrame(frameId);
      resolve(isReady);
    }

    function checkSize() {
      if (searchToken !== appState.searchToken) {
        finish(false);
        return;
      }
      const bounds = mapElement.getBoundingClientRect();
      if (bounds.width > 0 && bounds.height > 0) {
        finish(true);
        return;
      }
      frameId = window.requestAnimationFrame(checkSize);
    }

    frameId = window.requestAnimationFrame(checkSize);
  });
}

async function focusMapOnLocation(latitude, longitude, zoom = 15, searchToken = appState.searchToken) {
  const map = getMap();
  if (!map) return false;

  // GPS 검색으로 숨겨진 결과 영역을 열고 지도 탭을 선택합니다. 지도 컨테이너에
  // 실제 크기가 생길 때까지 최대 1초 기다려, 숨겨진 크기에서 이동하지 않도록 합니다.
  elements.mainContent.hidden = false;
  setView('map');
  const mapElement = map.getContainer();
  const hasSize = await waitForMapContainerSize(mapElement, searchToken, 1000);
  if (!hasSize || searchToken !== appState.searchToken) return false;

  // 컨테이너 크기를 Leaflet에 반영하고, 다음 프레임에도 크기가 유효한지 확인한 뒤 이동합니다.
  map.invalidateSize({ pan: false });
  await waitForAnimationFrame();
  if (searchToken !== appState.searchToken) return false;
  const bounds = mapElement.getBoundingClientRect();
  if (bounds.width <= 0 || bounds.height <= 0) return false;

  map.setView([latitude, longitude], zoom, { animate: false });
  return true;
}

function getAccurateCurrentPosition() {
  const requestPosition = options => new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('이 브라우저에서는 현재 위치를 사용할 수 없어요. 주소·장소를 검색해 주세요.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, options);
  });
  const locationError = error => {
    const message = error.code === 1
      ? '위치 권한이 꺼져 있어요. 브라우저와 기기의 위치 권한을 허용한 뒤 다시 눌러 주세요.'
      : '현재 위치를 받지 못했어요. 기기의 위치 서비스를 켜고 다시 시도해 주세요. 계속 안 되면 다른 브라우저에서 열어 주세요.';
    return Object.assign(new Error(message), { code: error.code });
  };
  return requestPosition({ enableHighAccuracy: true, timeout: 8000, maximumAge: 1000 })
    .catch(async error => {
      if (error.code === 1 || !navigator.geolocation) throw locationError(error);
      try {
        // GPS가 잡히지 않는 환경에서는 네트워크 기반 위치도 요청합니다.
        return await requestPosition({ enableHighAccuracy: false, timeout: 8000, maximumAge: 30000 });
      } catch (fallbackError) {
        throw locationError(fallbackError);
      }
    });
}

function getSearchRouteOrigin() {
  if (window.SearchRouteOrigin?.resolve) return window.SearchRouteOrigin.resolve(appState);
  const origin = appState.searchOrigin || appState.userLocation;
  return origin ? { lat: origin.lat, lng: origin.lng, name: origin.name || appState.searchLabel || '선택한 위치' } : null;
}

function hideSuggestions() {
  window.clearTimeout(appState.suggestionDebounceTimer);
  appState.suggestionController?.abort();
  appState.suggestionController = null;
  if (!elements.searchSuggestions) return;
  elements.searchInput.setAttribute('aria-expanded', 'false');
  elements.searchInput.removeAttribute('aria-activedescendant');
  elements.searchSuggestions.hidden = true;
  elements.searchSuggestions.innerHTML = '';
  appState.activeSuggestionIndex = -1;
  appState.currentSuggestions = [];
  appState.suggestionQuery = '';
  appState.suggestionToken += 1;
}

function showSuggestionMessage(message, className = 'suggestion-empty') {
  elements.searchSuggestions.innerHTML = `<div class="${className}">${escapeHtml(message)}</div>`;
  elements.searchSuggestions.hidden = false;
  elements.searchInput.setAttribute('aria-expanded', 'true');
}

function renderSuggestions(suggestions, query = elements.searchInput.value.trim()) {
  appState.suggestionQuery = query;
  appState.currentSuggestions = suggestions;
  appState.activeSuggestionIndex = -1;
  if (!suggestions.length) {
    showSuggestionMessage('검색 결과가 없습니다. 다른 검색어를 입력해 주세요.');
    return;
  }
  elements.searchSuggestions.innerHTML = suggestions.map((item, index) => {
    const title = item.name || item.label?.split(',')[0] || '검색 위치';
    const description = [item.label || item.type || '', item.distanceText ? '내 위치에서 직선거리 ' + item.distanceText : ''].filter(Boolean).join(' · ');
    return `<button type="button" class="search-suggestion-item" id="place-suggestion-${index}" role="option" aria-selected="false" data-suggestion-index="${index}">
      <span class="suggestion-icon" aria-hidden="true">⌖</span><span class="suggestion-content"><span class="suggestion-title">${escapeHtml(title)}</span><span class="suggestion-desc">${escapeHtml(description)}</span></span>
    </button>`;
  }).join('');
  elements.searchSuggestions.hidden = false;
  elements.searchInput.setAttribute('aria-expanded', 'true');
}


function chooseSuggestion(index) {
  const result = appState.currentSuggestions[index];
  if (!result) return;
  elements.searchInput.value = result.name || result.label?.split(',')[0] || '';
  hideSuggestions();
  elements.searchInput.blur();
  void searchAndDisplayPlaces(result.lat, result.lng, result.name || result.label?.split(',')[0] || '검색한 위치', null, 1000, false);
}

async function requestPlaceSuggestions() {
  const query = elements.searchInput.value.trim();
  if (!query) return;
  hideSuggestions();
  const token = ++appState.suggestionToken;
  const controller = new AbortController();
  appState.suggestionController = controller;
  const timeout = window.setTimeout(() => controller.abort('timeout'), 15000);
  showSuggestionMessage('장소를 찾는 중...', 'suggestion-loading');
  try {
    const location = appState.userLocation ? { ...appState.userLocation } : null;
    appState.suggestionLocationKey = location ? location.lat.toFixed(3) + ',' + location.lng.toFixed(3) : 'national';
    const results = await Data.searchAddress(query, 8, location, { signal: controller.signal });
    const currentKey = appState.userLocation ? appState.userLocation.lat.toFixed(3) + ',' + appState.userLocation.lng.toFixed(3) : 'national';
    if (currentKey !== appState.suggestionLocationKey) { void requestPlaceSuggestions(); return; }
    if (token !== appState.suggestionToken || elements.searchInput.value.trim() !== query) return;
    renderSuggestions(results, query);
  } catch (error) {
    if (token !== appState.suggestionToken) return;
    showSuggestionMessage(controller.signal.aborted ? '검색 응답이 늦습니다. 검색 버튼으로 다시 시도해 주세요.' : error.message || '장소 검색에 실패했습니다.');
  } finally {
    window.clearTimeout(timeout);
    if (appState.suggestionController === controller) appState.suggestionController = null;
  }
}

async function submitAddressSearch() {
  if (appState.composingSearch) return;
  if (!elements.searchInput.value.trim()) { hideSuggestions(); elements.searchInput.focus(); return; }
  await requestPlaceSuggestions();
}

function schedulePlaceSuggestions() {
  hideSuggestions();
  if (elements.searchInput.value.trim().length < 2) return;
  showSuggestionMessage('장소를 찾는 중...', 'suggestion-loading');
  appState.suggestionDebounceTimer = window.setTimeout(() => void requestPlaceSuggestions(), 250);
}

function chooseSuggestionFromResult(result) {
  hideSuggestions();
  elements.searchInput.blur();
  const label = result.name || result.label?.split(',')[0] || '검색한 위치';
  elements.searchInput.value = label;
  return searchAndDisplayPlaces(result.lat, result.lng, label, null, 1000, false);
}

function mergePlaceUpdates(previous, incoming) {
  const byId = new Map(previous.map(place => [place.id, place]));
  for (const place of incoming) {
    const old = byId.get(place.id);
    const routeFields = old && old.routeStatus !== 'not-calculated' && (!place.routeStatus || place.routeStatus === 'not-calculated')
      ? { routeStatus: old.routeStatus, routeError: old.routeError, routeDistanceMeters: old.routeDistanceMeters, routeDurationSeconds: old.routeDurationSeconds, routeDistanceText: old.routeDistanceText, routeDurationText: old.routeDurationText } : {};
    byId.set(place.id, old ? { ...old, ...place, ...routeFields, details: { ...(old.details || {}), ...(place.details || {}) } } : place);
  }
  return [...byId.values()];
}

function normalizePlace(place) {
  return { ...place, routeStatus: place.routeStatus || 'not-calculated', routeError: place.routeError || null };
}

function acceptPlaceUpdate(update, token, preserveExisting) {
  if (token !== appState.searchToken) return;
  const next = (update.places || []).map(normalizePlace);
  appState.places = mergePlaceUpdates(appState.places, next);
  appState.currentRadius = update.radiusMeters || appState.currentRadius;
  appState.isSearching = !update.isDone && !appState.places.length;
  appState.backgroundSearching = !update.isDone;
  if (update.isDone) appState.searchPartialFailure = Boolean(update.hasPartialFailure);
  elements.mainContent.hidden = false;
  elements.listPanel.hidden = false;
  renderPlaces();
  renderMarkers();
  if (appState.places.length) {
    Utils.setLoading(false);
    elements.locationHint.textContent = `${appState.searchLabel} 주변 장소 ${appState.places.length}곳을 표시했습니다.${update.isDone ? '' : ' 추가 장소를 확인하고 있어요.'}`;
    if (update.isDone && update.hasPartialFailure) {
      elements.locationHint.textContent += ' 일부 장소 데이터 조회에 실패해 결과가 빠질 수 있어요.';
      Utils.showToast('일부 장소 데이터를 불러오지 못했어요. 잠시 후 다시 검색해 주세요.');
    }
    const pending = appState.places.filter(place => !appState.enrichedPlaceIds.has(place.id)).slice(0, Math.max(0, 12 - appState.enrichedPlaceIds.size));
    pending.forEach(place => appState.enrichedPlaceIds.add(place.id));
    if (pending.length) void enrichWalkingRoutes(token, pending, { ...appState.searchOrigin });
  }
}

async function searchAndDisplayPlaces(lat, lng, label = '선택한 위치', accuracy = null, radius = appState.currentRadius, useGps = false, options = {}) {
  const latitude = Number(lat), longitude = Number(lng), searchRadius = Number(radius);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    Utils.showToast('검색 위치 좌표가 올바르지 않습니다.', 'error');
    return;
  }
  stopNavigation(false);
  const token = ++appState.searchToken;
  appState.isSearching = true;
  appState.backgroundSearching = true;
  appState.enrichedPlaceIds = new Set();
  appState.searchOriginKind = options.originKind || (useGps ? 'gps' : 'address');
  appState.searchError = null;
  appState.searchPartialFailure = false;
  if (useGps) {
    appState.userLocation = { lat: latitude, lng: longitude, name: '내 위치' };
    appState.userLocationAccuracy = accuracy;
    startUserLocationWatch();
  }
  const preserveExisting = options.preserveExisting === true;
  appState.routeToken += 1;
  appState.currentRadius = Number.isFinite(searchRadius) && searchRadius > 0 ? searchRadius : 1000;
  appState.searchOrigin = { lat: latitude, lng: longitude, name: label || '선택한 위치' };
  appState.searchLabel = label || '선택한 위치';
  appState.routeMode = 'search';
  appState.selectedPlace = null;
  appState.routeInfo = null;
  appState.searchRouteSnapshot = null;
  if (appState.routeLine) { appState.routeLine.remove(); appState.routeLine = null; }
  if (!preserveExisting) appState.places = [];
  elements.mainContent.hidden = false;
  elements.listPanel.hidden = false;
  elements.navPanel.hidden = true;
  elements.bottomSheet.hidden = true;
  elements.bottomSheet.classList.remove('open');
  document.body.classList.remove('place-detail-open');
  elements.sheetBackdrop.hidden = true;
  elements.locationHint.textContent = `${appState.searchLabel} 주변 휴식공간을 찾고 있습니다...`;
  renderPlaces();
  renderMarkers();
  if (useGps) {
    const focused = await focusMapOnLocation(latitude, longitude, 17, token);
    if (token !== appState.searchToken) return;
    if (!focused) {
      const message = '지도를 표시할 수 없어 현재 위치 검색을 중단했습니다. 화면을 다시 연 뒤 재시도해 주세요.';
      appState.isSearching = false;
      appState.searchError = message;
      elements.locationHint.textContent = message;
      Utils.setLoading(false);
      renderPlaces();
      Utils.showToast(message, 'error');
      return;
    }
  } else if (appState.map) {
    appState.map.setView([latitude, longitude], 15);
  }
  Utils.setLoading(true, `${appState.searchLabel} 주변 휴식공간을 찾는 중...`);

  try {
    const result = await Data.fetchPlacesFromOSM(latitude, longitude, {
      radiusMeters: appState.currentRadius,
      onProgress: () => {},
      onUpdate: update => acceptPlaceUpdate(update, token, preserveExisting)
    });
    if (token !== appState.searchToken) return;
    const finalPlaces = (result.places || []).map(normalizePlace);
    appState.places = mergePlaceUpdates(appState.places, finalPlaces);
    appState.currentRadius = result.radiusMeters || appState.currentRadius;
    appState.isSearching = false;
    appState.backgroundSearching = !result.isDone;
    elements.mainContent.hidden = false;
    elements.listPanel.hidden = false;
    renderPlaces();
    renderMarkers();
    Utils.setLoading(false);
    if (!appState.places.length) {
      elements.locationHint.textContent = result.allFailed
        ? '장소 데이터 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.'
        : `${appState.searchLabel} 주변에서 장소를 찾지 못했습니다. 검색 반경을 넓혀보세요.`;
    } else {
      elements.locationHint.textContent = `${appState.searchLabel} 주변 장소 ${appState.places.length}곳을 표시했습니다.${result.isDone ? '' : ' 추가 장소를 확인하고 있어요.'}`;
    }
    if (result.hasPartialFailure) Utils.showToast('일부 장소 데이터 서버에 연결하지 못했습니다. 받은 결과는 계속 표시합니다.');
    if (useGps) {
      appState.userLocation = { lat: latitude, lng: longitude, name: '내 위치' };
      appState.userLocationAccuracy = Number.isFinite(Number(accuracy)) ? Number(accuracy) : null;
      startUserLocationWatch();
      renderMarkers();
    }
  } catch (error) {
    if (token !== appState.searchToken) return;
    appState.isSearching = false;
    appState.backgroundSearching = false;
    console.error('주변 장소 검색 실패:', error);
    appState.searchError = '주변 장소를 불러오지 못했어요.';
    Utils.setLoading(false);
    renderPlaces();
    renderMarkers();
    const message = '주변 장소를 불러오지 못했어요.';
    elements.locationHint.textContent = appState.places.length
      ? `${message} 기존에 받은 장소는 유지했습니다.`
      : `${message} 잠시 후 다시 시도하거나 검색 반경을 넓혀보세요.`;
    if (!appState.places.length) Utils.showToast(message, 'error');
  }
}

async function enrichWalkingRoutes(token, places, origin) {
  if (!places.length || token !== appState.searchToken) return;
  try {
    const routed = await Data.addWalkingRoutes(places, origin);
    if (token !== appState.searchToken) return;
    const merged = window.RouteCandidatePreservation
      ? window.RouteCandidatePreservation.preserve(places, routed)
      : mergePlaceUpdates(places, routed);
    const byId = new Map(merged.map(place => [place.id, place]));
    appState.places = appState.places.map(place => byId.get(place.id) || place);
    renderPlaces();
    renderMarkers();
    if (!appState.backgroundSearching && !appState.searchPartialFailure) elements.locationHint.textContent = `${appState.searchLabel} 주변 장소를 표시했어요.`;
  } catch (error) {
    console.warn('주변 장소 경로 계산 실패:', error.message);
  }
}

async function getCurrentLocation() {
  if (!navigator.geolocation) {
    Utils.showToast('현재 위치를 사용할 수 없습니다. 주소나 장소를 검색해 주세요.', 'error');
    return;
  }
  elements.btnCurrentLocation.disabled = true;
  Utils.setLoading(true, '현재 위치를 확인하는 중...');
  try {
    const position = await getAccurateCurrentPosition();
    const { latitude, longitude, accuracy } = position.coords;
    await searchAndDisplayPlaces(latitude, longitude, '내 위치', accuracy, appState.currentRadius || 1000, true);
  } catch (error) {
    const message = error.code === 1
      ? '위치 권한이 거부되었습니다. 브라우저 설정에서 허용하거나 주소를 검색해 주세요.'
      : error.message || '현재 위치를 가져오지 못했습니다. GPS 신호를 확인해 주세요.';
    elements.locationHint.textContent = message;
    Utils.showToast(message, 'error');
  } finally {
    elements.btnCurrentLocation.disabled = false;
    Utils.setLoading(false);
  }
}

function startUserLocationWatch() {
  if (!navigator.geolocation || appState.userWatchId != null) return;
  appState.userWatchId = navigator.geolocation.watchPosition(position => {
    const { latitude, longitude, accuracy } = position.coords;
    appState.userLocation = { lat: latitude, lng: longitude, name: '내 위치' };
    appState.userLocationAccuracy = accuracy;
    updateLocationMarkerPositions();
    const locationKey = latitude.toFixed(3) + ',' + longitude.toFixed(3);
    if (appState.suggestionLocationKey !== locationKey && !elements.searchSuggestions.hidden && elements.searchInput.value.trim().length >= 2 && !appState.composingSearch) void requestPlaceSuggestions();
    if (appState.navigationActive) handleNavigationPosition(position);
  }, () => {
    if (!appState.navigationActive) elements.locationHint.textContent = '실시간 위치를 갱신하지 못했습니다. 위치 설정을 확인해 주세요.';
  }, { enableHighAccuracy: true, maximumAge: 1500, timeout: 15000 });
}

function updateLocationMarkerPositions() {
  const user = appState.userLocation;
  if (user && appState.userMarker) appState.userMarker.setLatLng([user.lat, user.lng]);
  if (user && appState.userAccuracyCircle && Number.isFinite(appState.userLocationAccuracy)) {
    appState.userAccuracyCircle.setLatLng([user.lat, user.lng]).setRadius(appState.userLocationAccuracy);
  }
  if (user && appState.map && !appState.userMarker) renderMarkers();
  if (appState.navigationActive && user && appState.navigationMarker) appState.navigationMarker.setLatLng([user.lat, user.lng]);
}

function renderMarkers() {
  const map = getMap();
  if (!map) return;
  for (const marker of appState.markers) marker.remove();
  appState.markers = [];
  if (appState.userMarker) appState.userMarker.remove();
  if (appState.searchOriginMarker) appState.searchOriginMarker.remove();
  if (appState.userAccuracyCircle) appState.userAccuracyCircle.remove();
  appState.userMarker = null;
  appState.searchOriginMarker = null;
  appState.userAccuracyCircle = null;

  if (appState.userLocation) {
    const accuracy = Number(appState.userLocationAccuracy);
    if (Number.isFinite(accuracy) && accuracy > 0 && accuracy <= 1000) {
      appState.userAccuracyCircle = L.circle([appState.userLocation.lat, appState.userLocation.lng], {
        radius: accuracy, color: '#2878d0', weight: 1, fillColor: '#2878d0', fillOpacity: 0.1
      }).addTo(map);
    }
    const heading = window.UserHeading?.getHeading?.() ?? null;
    const options = window.UserHeading
      ? { icon: window.UserHeading.createUserIcon(heading), zIndexOffset: 900 }
      : { zIndexOffset: 900 };
    appState.userMarker = L.marker([appState.userLocation.lat, appState.userLocation.lng], options)
      .addTo(map);
  }

  const origin = appState.searchOrigin;
  const distinctOrigin = origin && (!appState.userLocation || Math.abs(origin.lat - appState.userLocation.lat) > 1e-5 || Math.abs(origin.lng - appState.userLocation.lng) > 1e-5);
  if (distinctOrigin) {
    const icon = L.divIcon({
      className: 'search-origin-marker-container',
      html: '<span class="search-origin-marker" aria-hidden="true">⌖</span>',
      iconSize: [34, 34], iconAnchor: [17, 17]
    });
    appState.searchOriginMarker = L.marker([origin.lat, origin.lng], { icon, zIndexOffset: 800 })
      .addTo(map).bindPopup(`<strong>검색 출발 위치</strong><br>${escapeHtml(origin.name || appState.searchLabel)}`);
  }

  const createMarker = window.ParkMapMarkers?.createPlaceMarker;
  for (const place of appState.places) {
    const marker = createMarker
      ? createMarker({ map, place, onSelect: () => showPlaceDetail(place), escapeHtml, routeSummary })
      : L.marker([place.lat, place.lng]).addTo(map).bindPopup(escapeHtml(place.name));
    if (marker) appState.markers.push(marker);
  }
  appState.navigationMarker = appState.navigationActive ? appState.userMarker : null;
  updateLocationMarkerPositions();
  invalidateVisibleMap();
}

function routeSummary(place) {
  if (place.routeStatus === 'ok') return `도보 ${place.routeDistanceText || Data.formatRouteDistance(place.routeDistanceMeters)} · 약 ${place.routeDurationText || Data.formatRouteDuration(place.routeDurationSeconds)}`;
  if (place.routeStatus === 'error') return '경로를 불러오지 못했어요';
  return '';
}

function renderPlaces() {
  const origin = getSearchRouteOrigin();
  const distance = place => {
    if (place.routeStatus === 'ok' && Number.isFinite(place.routeDistanceMeters)) return place.routeDistanceMeters;
    return origin && Number.isFinite(place.lat) && Number.isFinite(place.lng)
      ? haversineMeters([origin.lat, origin.lng], [place.lat, place.lng]) : Infinity;
  };
  appState.places.sort((a, b) => distance(a) - distance(b));
  const sortLabel = document.querySelector('.sort-label');
  if (sortLabel) sortLabel.textContent = appState.places.length && appState.places.every(place => place.routeStatus === 'ok' && Number.isFinite(place.routeDistanceMeters)) ? '도보거리순' : '가까운순';
  const count = appState.places.length;
  elements.tabCount.textContent = count ? `(${count})` : '';
  elements.resultsCount.textContent = `휴식공간 ${count}곳`;
  elements.emptyState.hidden = count > 0 || appState.isSearching;
  elements.placesList.hidden = count === 0;
  elements.emptyState.querySelector('h3').textContent = appState.searchError ? '장소 데이터를 불러오지 못했어요' : '주변에서 장소를 찾지 못했어요';
  elements.emptyState.querySelector('p').textContent = appState.searchError ? '잠시 후 같은 위치를 다시 검색해 주세요.' : "다른 위치를 검색하거나 '더 넓게 검색'을 눌러보세요.";
  elements.expandSearchContainer.hidden = appState.currentRadius >= 2000;
  elements.expandSearchText.textContent = `더 넓게 검색 (반경 ${appState.currentRadius < 1500 ? '1.5' : '2'}km)`;
  elements.btnExpandSearch.disabled = appState.isSearching;
  elements.btnExpandSearch.setAttribute('aria-busy', String(appState.isSearching));
  if (!count) { elements.placesList.innerHTML = ''; return; }
  if (window.ParkResultsUI?.render) {
    elements.placesList.innerHTML = window.ParkResultsUI.render(appState.places, showPlaceDetail, routeSummary, escapeHtml);
    return;
  }
  elements.placesList.innerHTML = appState.places.map(place => `<button class="place-card" type="button">${escapeHtml(place.name)} · ${routeSummary(place)}</button>`).join('');
}

function setView(view) {
  const showMap = view !== 'list';
  appState.view = showMap ? 'map' : 'list';
  elements.tabMap.classList.toggle('active', showMap);
  elements.tabList.classList.toggle('active', !showMap);
  elements.tabMap.setAttribute('aria-selected', String(showMap));
  elements.tabList.setAttribute('aria-selected', String(!showMap));
  elements.mapPanel.classList.add('active');
  document.body.classList.toggle('list-open', !showMap);
  if (!showMap) elements.listPanel.dataset.size = 'half';
  elements.listPanel.classList.toggle('active', !showMap);
  elements.listPanel.hidden = false;
  invalidateVisibleMap();
}

function nextSearchRadius(radius) {
  if (radius < 1500) return 1500;
  if (radius < 2000) return 2000;
  return 2000;
}

function expandSearchRadius() {
  if (appState.isSearching || !appState.searchOrigin || appState.currentRadius >= 2000) return;
  const nextRadius = nextSearchRadius(appState.currentRadius);
  void searchAndDisplayPlaces(
    appState.searchOrigin.lat,
    appState.searchOrigin.lng,
    appState.searchLabel,
    null,
    nextRadius,
    false,
    { preserveExisting: true, originKind: appState.searchOriginKind }
  );
}

function openPlaceDetailSheet() {
  window.UnifiedPlacePanel?.open();
  elements.bottomSheet.hidden = false;
  elements.sheetBackdrop.hidden = true;
  requestAnimationFrame(() => elements.bottomSheet.classList.add('open'));
}

function closePlaceDetail() {
  if (appState.navigationActive) return;
  window.NavigationModes?.exitSearchViewer?.();
  appState.routeViewerActive = false;
  window.UnifiedPlacePanel?.close();
  elements.bottomSheet.classList.remove('open');
  elements.sheetBackdrop.hidden = true;
  elements.navPanel.hidden = true;
  window.setTimeout(() => {
    if (!elements.bottomSheet.classList.contains('open')) elements.bottomSheet.hidden = true;
  }, 260);
  appState.selectedPlace = null;
  appState.routeMode = 'search';
  appState.routeToken += 1;
  if (appState.routeLine) { appState.routeLine.remove(); appState.routeLine = null; }
  appState.routeInfo = null;
  renderPlaces();
  renderMarkers();
  updateNavigationControls();
}

function createPlaceDetailHtml(place) {
  const detailRows = [];
  const details = place.details || {};
  if (place.type) detailRows.push(['종류', place.type]);
  if (details.seating) detailRows.push(['착석 정보', details.seating]);
  if (details.locationNote) detailRows.push(['위치 참고', details.locationNote]);
  if (details.covered) detailRows.push(['그늘·지붕', details.covered]);
  if (details.backrest) detailRows.push(['등받이', details.backrest]);
  if (details.indoor) detailRows.push(['실내·실외', details.indoor]);
  if (details.wheelchair) detailRows.push(['접근성', details.wheelchair]);
  const osmMatch = /^osm-(node|way|relation)-(\d+)$/.exec(String(place.id));
  const osmUrl = osmMatch ? `https://www.openstreetmap.org/${osmMatch[1]}/${osmMatch[2]}` : null;
  return `${detailRows.map(([label, value]) => `<div class="detail-row"><span class="detail-label">${escapeHtml(label)}</span><span class="detail-value">${escapeHtml(value)}</span></div>`).join('')}
    ${osmUrl ? `<a class="external-directions" href="${osmUrl}" target="_blank" rel="noopener noreferrer">OpenStreetMap에서 보기</a>` : ''}
    <div id="routeDetails"></div>`;
}

function showPlaceDetail(place) {
  if (!place) return Promise.resolve();
  stopNavigation(false);
  appState.selectedPlace = place;
  appState.routeMode = 'search';
  appState.routeInfo = null;
  appState.routeToken += 1;
  const routeToken = appState.routeToken;
  if (appState.routeLine) { appState.routeLine.remove(); appState.routeLine = null; }
  elements.sheetTitle.textContent = place.name || '휴식공간';
  elements.sheetBody.innerHTML = createPlaceDetailHtml(place);
  elements.navPanel.hidden = false;
  elements.navInstruction.textContent = appState.searchOriginKind === 'gps' ? '현재 위치에서 도보 경로를 조회합니다.' : '선택한 위치에서 도보 경로를 조회합니다.';
  elements.navDistance.textContent = '';
  elements.navRemaining.textContent = '';
  elements.navStatus.textContent = '길을 찾는 중...';
  openPlaceDetailSheet();
  updateNavigationControls();
  return loadSearchOriginRoute(place, routeToken);
}

async function loadSearchOriginRoute(place, token) {
  const origin = getSearchRouteOrigin();
  if (!origin) {
    elements.navInstruction.textContent = '출발 위치가 필요합니다.';
    elements.navStatus.textContent = '현재 위치를 사용하거나 검색 위치를 먼저 설정해 주세요.';
    updatePlaceRouteState(place, 'not-calculated', null);
    return;
  }
  try {
    const route = await Data.requestWalkingRoute(origin, { lat: place.lat, lng: place.lng, name: place.name });
    if (token !== appState.routeToken || appState.selectedPlace?.id !== place.id) return;
    appState.routeInfo = route;
    appState.lastRouteStart = origin;
    appState.routeMode = 'search';
    setRouteLine(route);
    updatePlaceRouteState(place, 'ok', null, route);
    renderRouteDetails(place, route);
    elements.navInstruction.textContent = '도보 경로';
    elements.navDistance.textContent = `${Data.formatRouteDistance(route.distanceMeters)} · 약 ${Data.formatRouteDuration(route.durationSeconds)}`;
    elements.navRemaining.textContent = '';
    elements.navStatus.textContent = '';
    if (appState.map && appState.routeLine) appState.map.fitBounds(appState.routeLine.getBounds().pad(0.18), { maxZoom: 17 });
    updateNavigationControls();
  } catch (error) {
    if (token !== appState.routeToken || appState.selectedPlace?.id !== place.id) return;
    const message = error.message || 'TMAP 보행 경로 요청에 실패했습니다.';
    updatePlaceRouteState(place, 'error', message);
    elements.navInstruction.textContent = '도보 경로를 불러오지 못했습니다.';
    elements.navDistance.textContent = '';
    elements.navRemaining.textContent = '';
    elements.navStatus.textContent = `${message} 장소와 지도는 계속 표시됩니다.`;
    elements.btnRecalculateRoute.hidden = false;
    Utils.showToast('도보 경로를 불러오지 못했지만 장소와 지도는 유지됩니다.', 'error');
    updateNavigationControls();
  }
}

function updatePlaceRouteState(place, status, error = null, route = null) {
  const updated = {
    ...place,
    routeStatus: status,
    routeError: error,
    ...(route ? {
      routeDistanceMeters: route.distanceMeters,
      routeDurationSeconds: route.durationSeconds,
      routeDistanceText: Data.formatRouteDistance(route.distanceMeters),
      routeDurationText: Data.formatRouteDuration(route.durationSeconds)
    } : {})
  };
  appState.selectedPlace = updated;
  const index = appState.places.findIndex(item => item.id === updated.id);
  if (index >= 0) appState.places[index] = updated;
  renderPlaces();
  renderMarkers();
}

function setRouteLine(route) {
  if (!appState.map || !route?.coordinates?.length) return null;
  if (appState.routeLine) appState.routeLine.remove();
  appState.routeLine = L.polyline(route.coordinates, { color: '#176d5b', weight: 6, opacity: 0.86, lineCap: 'round', lineJoin: 'round' }).addTo(appState.map);
  return appState.routeLine;
}

async function fitVisibleRoute(token = appState.routeToken) {
  await waitForAnimationFrame();
  await waitForAnimationFrame();
  if (token !== appState.routeToken || !appState.map || !appState.routeLine) return;
  const map = appState.map;
  map.invalidateSize({ pan: false });
  const size = map.getSize();
  if (size.x <= 0 || size.y <= 0) return;
  const panel = elements.navPanel.getBoundingClientRect();
  const narrow = size.x < 860;
  map.fitBounds(appState.routeLine.getBounds(), {
    paddingTopLeft: narrow ? [28, Math.min(panel.bottom + 20, size.y * .55)] : [Math.min(panel.right + 24, size.x * .48), 40],
    paddingBottomRight: [28, 80], maxZoom: 17, animate: false
  });
}

function koreanizeInstruction(instruction) {
  if (window.NavigationGuidance?.koreanizeInstruction) return window.NavigationGuidance.koreanizeInstruction(instruction);
  return String(instruction || '').replace(/Turn left/gi, '왼쪽으로 이동').replace(/Turn right/gi, '오른쪽으로 이동').replace(/Continue/gi, '계속 이동');
}

function renderRouteDetails(place, route) {
  const target = document.getElementById('routeDetails');
  if (!target) return;
  const steps = route.steps || [];
  const stepsHtml = steps.length
    ? `<h3 class="directions-title">도보 경로 안내</h3><ol class="directions-list">${steps.map(step => `<li class="direction-step"><span>${escapeHtml(koreanizeInstruction(step.instruction))}</span><small>${step.distanceMeters > 0 ? escapeHtml(Data.formatRouteDistance(step.distanceMeters)) : ''}</small></li>`).join('')}</ol>`
    : '<p class="directions-empty">자세한 안내는 지도에서 경로를 확인해 주세요.</p>';
  target.innerHTML = `<div class="detail-row"><span class="detail-label">도보 거리</span><span class="detail-value">${escapeHtml(Data.formatRouteDistance(route.distanceMeters))}</span></div><div class="detail-row"><span class="detail-label">예상 시간</span><span class="detail-value">약 ${escapeHtml(Data.formatRouteDuration(route.durationSeconds))}</span></div>${stepsHtml}`;
}

async function showSearchOriginRoute() {
  const place = appState.selectedPlace;
  if (!place) { Utils.showToast('먼저 목적지를 선택해 주세요.', 'error'); return; }
  if (appState.navigationActive) stopNavigation(false);
  const token = ++appState.routeToken;
  appState.routeMode = 'search';
  const origin = getSearchRouteOrigin();
  if (!origin) { Utils.showToast('검색 출발 위치를 확인할 수 없습니다.', 'error'); return; }
  elements.navStatus.textContent = '선택한 위치에서 길을 찾는 중...';
  Utils.setLoading(true, '검색 위치에서 목적지까지 경로를 계산하는 중...');
  try {
    const route = await Data.requestWalkingRoute(origin, { lat: place.lat, lng: place.lng, name: place.name });
    if (token !== appState.routeToken || appState.selectedPlace?.id !== place.id) return;
    appState.routeInfo = route;
    appState.lastRouteStart = origin;
    setRouteLine(route);
    updatePlaceRouteState(place, 'ok', null, route);
    renderRouteDetails(place, route);
    elements.navInstruction.textContent = '도보 경로';
    elements.navDistance.textContent = `${Data.formatRouteDistance(route.distanceMeters)} · 약 ${Data.formatRouteDuration(route.durationSeconds)}`;
    elements.navRemaining.textContent = '';
    elements.navStatus.textContent = '아래 버튼을 누르면 현재 위치에서 안내를 시작해요.';
    setView('map');
    appState.routeViewerActive = true;
    window.NavigationModes?.enterSearchViewer?.();
    updateNavigationControls();
    await fitVisibleRoute(token);
  } catch (error) {
    if (token !== appState.routeToken || appState.selectedPlace?.id !== place.id) return;
    elements.navStatus.textContent = error.message || 'TMAP 경로 요청에 실패했습니다. 장소와 지도는 유지됩니다.';
    updatePlaceRouteState(place, 'error', elements.navStatus.textContent);
  } finally {
    Utils.setLoading(false);
    updateNavigationControls();
  }
}

function findNearestRoutePosition(current) {
  const route = appState.routeInfo;
  if (!route?.coordinates?.length) return { nearestIndex: 0, progressMeters: 0, distanceMeters: Infinity };
  const scaleLat = 111320, scaleLng = scaleLat * Math.cos(current.lat * Math.PI / 180);
  const cumulative = route.cumulativeMeters || [];
  let closest = Infinity, nearestIndex = 0, progressMeters = 0;
  for (let index = 0; index < route.coordinates.length - 1; index += 1) {
    const a = route.coordinates[index], b = route.coordinates[index + 1];
    const ax = (a[1] - current.lng) * scaleLng, ay = (a[0] - current.lat) * scaleLat;
    const dx = (b[1] - a[1]) * scaleLng, dy = (b[0] - a[0]) * scaleLat;
    const lengthSquared = dx * dx + dy * dy;
    const ratio = lengthSquared ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSquared)) : 0;
    const distance = Math.hypot(ax + ratio * dx, ay + ratio * dy);
    if (distance < closest) {
      closest = distance;
      nearestIndex = index;
      progressMeters = (cumulative[index] || 0) + ratio * ((cumulative[index + 1] || 0) - (cumulative[index] || 0));
    }
  }
  return { nearestIndex, progressMeters, distanceMeters: closest };
}

function haversineMeters(a, b) {
  const radians = degrees => degrees * Math.PI / 180;
  const lat1 = radians(a[0]), lat2 = radians(b[0]), dLat = lat2 - lat1, dLng = radians(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function updateNavigationGuidance(current, routePosition) {
  if (window.NavigationGuidance?.update) window.NavigationGuidance.update(appState, elements, current, routePosition, Data);
}

function handleNavigationPosition(position) {
  if (!appState.navigationActive || !appState.routeInfo) return;
  const current = {
    lat: position.coords.latitude,
    lng: position.coords.longitude,
    accuracy: position.coords.accuracy
  };
  appState.navigationPosition = current;
  appState.userLocation = { lat: current.lat, lng: current.lng, name: '내 실제 위치' };
  appState.userLocationAccuracy = current.accuracy;
  const nearest = findNearestRoutePosition(current);
  const accurate = !Number.isFinite(current.accuracy) || current.accuracy <= 80;
  if (accurate && nearest.distanceMeters <= 50) appState.routeProgressMeters = nearest.progressMeters;
  if (appState.navigationMarker) appState.navigationMarker.setLatLng([current.lat, current.lng]);
  else if (appState.userMarker) appState.userMarker.setLatLng([current.lat, current.lng]);
  updateLocationMarkerPositions();
  updateNavigationGuidance(current, nearest);
  if (appState.followNavigation && appState.map) appState.map.panTo([current.lat, current.lng], { animate: true, duration: 0.35 });
}

async function startNavigation() {
  const place = appState.selectedPlace;
  if (!place) { Utils.showToast('먼저 목적지를 선택해 주세요.', 'error'); return; }
  if (!navigator.geolocation) { Utils.showToast('이 브라우저에서는 GPS 실시간 안내를 사용할 수 없습니다.', 'error'); return; }
  if (appState.navigationActive || elements.btnStartNavigation.disabled) return;
  elements.btnStartNavigation.disabled = true;
  const token = ++appState.routeToken;
  Utils.setLoading(true, '현재 위치에서 길을 찾는 중...');
  try {
    const position = await getAccurateCurrentPosition();
    if (token !== appState.routeToken || appState.selectedPlace?.id !== place.id) return;
    const start = { lat: position.coords.latitude, lng: position.coords.longitude, name: '내 실제 위치' };
    appState.userLocation = start;
    appState.userLocationAccuracy = position.coords.accuracy;
    appState.searchRouteSnapshot = appState.routeInfo && appState.routeMode === 'search'
      ? { route: appState.routeInfo, start: appState.lastRouteStart }
      : null;
    appState.routeMode = 'live';
    const route = await Data.requestWalkingRoute(start, { lat: place.lat, lng: place.lng, name: place.name });
    if (token !== appState.routeToken || appState.selectedPlace?.id !== place.id) return;
    appState.routeInfo = route;
    appState.lastRouteStart = start;
    appState.routeProgressMeters = 0;
    appState.navigationActive = true;
    setView('map');
    appState.routeViewerActive = false;
    appState.followNavigation = true;
    appState.navigationPosition = start;
    renderMarkers();
    appState.navigationMarker = appState.userMarker;
    setRouteLine(route);
    window.NavigationModes?.enterLive?.(elements.navPanel, elements.bottomSheet, elements.mainContent);
    elements.navPanel.hidden = false;
    elements.navInstruction.textContent = '경로를 따라 이동하세요';
    elements.navDistance.textContent = `${Data.formatRouteDistance(route.distanceMeters)} · 약 ${Data.formatRouteDuration(route.durationSeconds)}`;
    elements.navRemaining.textContent = `목적지까지 ${Data.formatRouteDistance(route.distanceMeters)}`;
    elements.navStatus.textContent = '현재 위치를 따라 안내하고 있어요.';
    if (appState.userWatchId == null) startUserLocationWatch();
    updateNavigationControls();
    await fitVisibleRoute(token);
    if (token !== appState.routeToken || !appState.navigationActive) return;
    handleNavigationPosition(position);
  } catch (error) {
    if (token !== appState.routeToken) return;
    appState.routeMode = 'search';
    appState.navigationActive = false;
    elements.navStatus.textContent = error.message || '실시간 안내 경로를 불러오지 못했습니다.';
    Utils.showToast(elements.navStatus.textContent, 'error');
    updateNavigationControls();
  } finally {
    elements.btnStartNavigation.disabled = false;
    Utils.setLoading(false);
  }
}

function stopNavigation(showMessage = true) {
  const wasActive = appState.navigationActive;
  appState.routeToken += 1;
  appState.navigationActive = false;
  appState.routeMode = 'search';
  appState.rerouteInProgress = false;
  appState.routeViewerActive = false;
  if (appState.locationWatchId != null && navigator.geolocation) {
    navigator.geolocation.clearWatch(appState.locationWatchId);
    appState.locationWatchId = null;
  }
  if (window.NavigationModes?.exitLive) window.NavigationModes.exitLive(elements.navPanel, elements.bottomSheet, elements.mainContent);
  else document.body.classList.remove('navigation-mode');
  appState.navigationMarker = null;
  if (appState.searchRouteSnapshot?.route) {
    appState.routeInfo = appState.searchRouteSnapshot.route;
    if (appState.searchRouteSnapshot.start) appState.lastRouteStart = appState.searchRouteSnapshot.start;
    setRouteLine(appState.routeInfo);
  } else if (wasActive) {
    appState.routeInfo = null;
    if (appState.routeLine) { appState.routeLine.remove(); appState.routeLine = null; }
  }
  appState.searchRouteSnapshot = null;
  invalidateVisibleMap();
  updateNavigationControls();
  if (showMessage && wasActive) Utils.showToast('실시간 안내를 종료했습니다.');
  if (appState.selectedPlace && appState.routeInfo) {
    renderRouteDetails(appState.selectedPlace, appState.routeInfo);
    elements.navInstruction.textContent = '도보 경로';
    elements.navDistance.textContent = `${Data.formatRouteDistance(appState.routeInfo.distanceMeters)} · 약 ${Data.formatRouteDuration(appState.routeInfo.durationSeconds)}`;
    elements.navRemaining.textContent = '';
    elements.navStatus.textContent = '안내를 종료했어요.';
  }
}

async function recalculateNavigationRoute() {
  const place = appState.selectedPlace;
  if (!place) return;
  if (!appState.navigationActive) {
    await showSearchOriginRoute();
    return;
  }
  if (appState.rerouteInProgress || !appState.navigationPosition) return;
  appState.rerouteInProgress = true;
  const token = ++appState.routeToken;
  try {
    const start = { ...appState.navigationPosition, name: '내 실제 위치' };
    const route = await Data.requestWalkingRoute(start, { lat: place.lat, lng: place.lng, name: place.name });
    if (!appState.navigationActive || token !== appState.routeToken) return;
    appState.routeInfo = route;
    appState.routeProgressMeters = 0;
    setRouteLine(route);
    elements.navStatus.textContent = '현재 위치에서 경로를 다시 찾았어요.';
    if (appState.navigationPosition) handleNavigationPosition({ coords: { latitude: appState.navigationPosition.lat, longitude: appState.navigationPosition.lng, accuracy: appState.navigationPosition.accuracy } });
  } catch (error) {
    elements.navStatus.textContent = error.message || '경로를 다시 계산하지 못했습니다.';
  } finally {
    appState.rerouteInProgress = false;
  }
}

function updateNavigationControls() {
  const active = appState.navigationActive;
  const hasPlace = Boolean(appState.selectedPlace);
  elements.btnStartNavigation.hidden = active || !hasPlace;
  elements.btnSearchRouteStart.hidden = active || appState.routeViewerActive || !hasPlace || appState.searchOriginKind === 'gps';
  elements.btnStopNavigation.hidden = !active;
  elements.btnPreviewRoute.hidden = active ? appState.searchOriginKind === 'gps' || !appState.searchRouteSnapshot?.route : !appState.routeViewerActive;
  elements.btnPreviewRoute.textContent = active ? '검색 위치 경로로 돌아가기' : '상세 정보로 돌아가기';
  elements.btnRecalculateRoute.hidden = active
    ? false
    : !hasPlace || appState.selectedPlace?.routeStatus !== 'error';
  elements.btnFollowNavigation.hidden = !active;
  elements.btnFollowNavigation.classList.toggle('following', appState.followNavigation);
  elements.btnFollowNavigation.textContent = appState.followNavigation ? '위치 따라가는 중' : '위치 따라가기';
  const kicker = elements.navPanel.querySelector('.nav-kicker');
  if (kicker && hasPlace && !active) {
    const origin = getSearchRouteOrigin();
    kicker.textContent = `출발: ${origin?.name || appState.searchLabel} → 도착: ${appState.selectedPlace.name}`;
  }
}

function setupEventListeners() {
  elements.searchForm.addEventListener('submit', event => { event.preventDefault(); void submitAddressSearch(); });
  elements.placesList.addEventListener('click', event => {
    const card = event.target.closest('[data-place-id]');
    const place = card && appState.places.find(item => item.id === card.dataset.placeId);
    if (place) showPlaceDetail(place);
  });
  elements.searchInput.addEventListener('input', schedulePlaceSuggestions);
  elements.searchInput.addEventListener('compositionstart', () => { appState.composingSearch = true; });
  elements.searchInput.addEventListener('compositionend', () => { appState.composingSearch = false; schedulePlaceSuggestions(); });
  elements.searchInput.addEventListener('focus', schedulePlaceSuggestions);
  elements.searchInput.addEventListener('keydown', event => {
    if (event.isComposing || appState.composingSearch) return;
    const items = [...elements.searchSuggestions.querySelectorAll('.search-suggestion-item')];
    if (event.key === 'Enter' && items.length) {
      event.preventDefault(); chooseSuggestion(appState.activeSuggestionIndex >= 0 ? appState.activeSuggestionIndex : 0); return;
    }
    if (event.key === 'ArrowDown' && items.length) {
      event.preventDefault(); appState.activeSuggestionIndex = (appState.activeSuggestionIndex + 1) % items.length; updateSuggestionHighlight(items);
    } else if (event.key === 'ArrowUp' && items.length) {
      event.preventDefault(); appState.activeSuggestionIndex = appState.activeSuggestionIndex < 0 ? items.length - 1 : (appState.activeSuggestionIndex - 1 + items.length) % items.length; updateSuggestionHighlight(items);
    } else if (event.key === 'Escape') hideSuggestions();
  });
  elements.searchSuggestions.addEventListener('click', event => {
    const button = event.target.closest('[data-suggestion-index]');
    if (button) chooseSuggestion(Number(button.dataset.suggestionIndex));
  });
  document.addEventListener('click', event => {
    if (!event.target.closest('.search-box-wrapper')) hideSuggestions();
  });
  elements.btnCurrentLocation.addEventListener('click', getCurrentLocation);
  elements.btnRecenter.addEventListener('click', () => {
    const point = appState.searchOrigin || appState.userLocation;
    if (point) getMap()?.setView([point.lat, point.lng], 16);
  });
  elements.btnUserLocation.addEventListener('click', () => {
    if (appState.userLocation) getMap()?.setView([appState.userLocation.lat, appState.userLocation.lng], 17);
    else Utils.showToast('현재 위치 정보를 사용할 수 없습니다.', 'error');
  });
  elements.tabMap.addEventListener('click', () => setView('map'));
  elements.tabList.addEventListener('click', () => setView('list'));
  elements.btnExpandSearch.addEventListener('click', expandSearchRadius);
  elements.btnCloseSheet.addEventListener('click', closePlaceDetail);
  elements.sheetBackdrop.addEventListener('click', closePlaceDetail);
  elements.btnSearchRouteStart.addEventListener('click', () => void showSearchOriginRoute());
  elements.btnStartNavigation.addEventListener('click', () => void startNavigation());
  elements.btnStopNavigation.addEventListener('click', () => stopNavigation());
  elements.btnPreviewRoute.addEventListener('click', () => {
    if (appState.navigationActive) { stopNavigation(false); return; }
    appState.routeViewerActive = false;
    window.NavigationModes?.exitSearchViewer?.();
    updateNavigationControls();
  });
  elements.btnRecalculateRoute.addEventListener('click', () => void recalculateNavigationRoute());
  elements.btnFollowNavigation.addEventListener('click', () => {
    appState.followNavigation = !appState.followNavigation;
    updateNavigationControls();
    if (appState.followNavigation && appState.navigationPosition) appState.map?.panTo([appState.navigationPosition.lat, appState.navigationPosition.lng]);
  });
  window.addEventListener('resize', invalidateVisibleMap);
  window.addEventListener('online', () => elements.locationHint.textContent = '인터넷에 다시 연결되었습니다.');
}

function updateSuggestionHighlight(items) {
  items.forEach((item, index) => {
    const active = index === appState.activeSuggestionIndex;
    item.classList.toggle('highlighted', active);
    item.setAttribute('aria-selected', String(active));
    if (active) { elements.searchInput.setAttribute('aria-activedescendant', item.id); item.scrollIntoView({ block: 'nearest' }); }
  });
}

// 위치 응답보다 사용자의 직접 검색이 먼저 시작됐다면 그 검색을 유지합니다.
async function locateOnArrival() {
  const token = appState.searchToken;
  if (!navigator.geolocation) {
    elements.locationHint.textContent = '현재 위치를 사용할 수 없어요. 주소·장소를 검색해 주세요.';
    return;
  }
  try {
    const position = await getAccurateCurrentPosition();
    if (token !== appState.searchToken || appState.searchOrigin) return;
    const { latitude, longitude, accuracy } = position.coords;
    await searchAndDisplayPlaces(latitude, longitude, '내 위치', accuracy, 1000, true);
  } catch (error) {
    if (token !== appState.searchToken || appState.searchOrigin) return;
    elements.locationHint.textContent = error.code === 1
      ? '위치를 허용하면 내 주변을 볼 수 있어요. 주소·장소로도 검색할 수 있어요.'
      : '현재 위치를 찾지 못했어요. 내 위치 버튼을 다시 누르거나 장소를 검색해 주세요.';
  }
}

function observeSearchLayout() {
  const location = document.querySelector('.location-section');
  if (!location || !window.ResizeObserver) return;
  const update = () => {
    const offset = location.getBoundingClientRect().bottom - elements.mainContent.getBoundingClientRect().top + 12;
    elements.mainContent.style.setProperty('--list-top', Math.max(0, offset) + 'px');
  };
  const observer = new ResizeObserver(update);
  observer.observe(location);
  observer.observe(document.querySelector('.header'));
  window.addEventListener('resize', update);
  update();
}

function initializeApp() {
  elements.mainContent.hidden = false;
  initializeMap();
  setupEventListeners();
  elements.listPanel.hidden = false;
  elements.navPanel.hidden = true;
  setView('map');
  updateNavigationControls();
  invalidateVisibleMap();
  observeSearchLayout();
  void locateOnArrival();
}

document.addEventListener('DOMContentLoaded', initializeApp, { once: true });

window.app = {
  searchAndDisplayPlaces,
  showPlaceDetail,
  closePlaceDetail,
  startNavigation,
  stopNavigation,
  expandSearchRadius,
  getCurrentLocation,
  showSearchOriginRoute,
  renderPlaces,
  renderMarkers
};

// 기존 인라인/외부 연동과 호환되는 명시적 전역 API.
window.searchAndDisplayPlaces = searchAndDisplayPlaces;
window.showPlaceDetail = showPlaceDetail;
window.closePlaceDetail = closePlaceDetail;
window.startNavigation = startNavigation;
window.stopNavigation = stopNavigation;
window.expandSearchRadius = expandSearchRadius;
window.renderMarkers = renderMarkers;
window.renderPlaces = renderPlaces;
window.getSearchRouteOrigin = getSearchRouteOrigin;
window.routeSummary = routeSummary;
window.escapeHtml = escapeHtml;
window.formatLocationAccuracy = formatLocationAccuracy;
window.invalidateVisibleMap = invalidateVisibleMap;
window.getMap = getMap;
window.setRouteLine = setRouteLine;
window.renderRouteDetails = renderRouteDetails;
window.updateNavigationGuidance = updateNavigationGuidance;
window.koreanizeInstruction = koreanizeInstruction;
window.findNearestRoutePosition = findNearestRoutePosition;
window.showRouteError = (place, error) => {
  const message = error?.message || 'TMAP 보행 경로 요청에 실패했습니다.';
  updatePlaceRouteState(place, 'error', message);
  elements.navStatus.textContent = `${message} 장소와 지도는 유지됩니다.`;
};

window.appState = appState;
window.elements = elements;
window.appElements = elements;

/*
 * 배포 ZIP 포함 파일: .env.example은 포함하고, 실제 .env와 node_modules는 제외합니다.
 * 앱 파일의 실제 실행은 사용자의 로컬 Node.js/브라우저 환경에서 확인해야 합니다.
 */

// 레거시 기능명은 실제 구현에 연결되어 있으며, 보정 스크립트가 이를 덮어쓰지 않습니다.
window.app.searchAndDisplayPlaces = searchAndDisplayPlaces;
window.app.showPlaceDetail = showPlaceDetail;
window.app.closePlaceDetail = closePlaceDetail;
window.app.startNavigation = startNavigation;
window.app.stopNavigation = stopNavigation;
window.app.expandSearchRadius = expandSearchRadius;

// 확대 검색과 GPS 안내에서 동일한 상태 객체를 참조하도록 전역을 단일화합니다.
window.appState = appState;

// 실시간 위치 marker 및 검색 위치 marker는 renderMarkers()에서 독립적으로 생성합니다.
function stopLocationTracking() {
  if (appState.userWatchId != null && navigator.geolocation) navigator.geolocation.clearWatch(appState.userWatchId);
  appState.userWatchId = null;
}
window.stopLocationTracking = stopLocationTracking;

// GPS 성공 때마다 실제 현재 위치와 검색 출발점을 혼동하지 않도록 별개 속성만 갱신합니다.
function setUserLocation(position) {
  appState.userLocation = { lat: position.coords.latitude, lng: position.coords.longitude, name: '내 실제 위치' };
  appState.userLocationAccuracy = position.coords.accuracy;
  updateLocationMarkerPositions();
}
window.setUserLocation = setUserLocation;

// 지도가 가려진 화면에서 되살아날 때 Leaflet 크기 계산을 갱신합니다.
window.addEventListener('pageshow', invalidateVisibleMap);
