// Leaflet + OSM + Overpass + TMAP 보행 경로와 모바일 우선 실시간 도보 안내.
const appState = {
  userLocation: null,
  userLocationAccuracy: null,
  userHeading: null,
  searchLabel: '선택한 위치',
  currentRadius: 1000,
  isSearching: false,
  places: [],
  map: null,
  markers: [],
  userMarker: null,
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
  currentSuggestions: []
};

const elements = {
  searchForm: document.getElementById('searchForm'), searchInput: document.getElementById('searchInput'),
  searchSuggestions: document.getElementById('searchSuggestions'),
  btnCurrentLocation: document.getElementById('btnCurrentLocation'), btnRecenter: document.getElementById('btnRecenter'),
  btnFollowNavigation: document.getElementById('btnFollowNavigation'), locationHint: document.getElementById('locationHint'),
  mainContent: document.getElementById('mainContent'), tabMap: document.getElementById('tabMap'), tabList: document.getElementById('tabList'),
  tabCount: document.getElementById('tabCount'), mapPanel: document.getElementById('mapPanel'), listPanel: document.getElementById('listPanel'),
  placesList: document.getElementById('placesList'), emptyState: document.getElementById('emptyState'), resultsCount: document.getElementById('resultsCount'),
  expandSearchContainer: document.getElementById('expandSearchContainer'), btnExpandSearch: document.getElementById('btnExpandSearch'),
  expandSearchText: document.getElementById('expandSearchText'),
  bottomSheet: document.getElementById('bottomSheet'), sheetTitle: document.getElementById('sheetTitle'), sheetBody: document.getElementById('sheetBody'),
  sheetBackdrop: document.getElementById('sheetBackdrop'), btnCloseSheet: document.getElementById('btnCloseSheet'), navPanel: document.getElementById('navPanel'),
  navInstruction: document.getElementById('navInstruction'), navDistance: document.getElementById('navDistance'), navRemaining: document.getElementById('navRemaining'),
  navStatus: document.getElementById('navStatus'), btnStartNavigation: document.getElementById('btnStartNavigation'),
  btnStopNavigation: document.getElementById('btnStopNavigation'), btnRecalculateRoute: document.getElementById('btnRecalculateRoute')
};

function getMap() {
  if (appState.map) return appState.map;
  appState.map = L.map('map', { zoomControl: true }).setView([36.5, 127.8], 7);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>'
  }).addTo(appState.map);
  appState.map.on('dragstart', () => {
    if (appState.navigationActive && appState.followNavigation) {
      appState.followNavigation = false;
      updateFollowButton();
    }
  });
  return appState.map;
}

function invalidateVisibleMap() {
  if (!appState.map || elements.mainContent.hidden || !elements.mapPanel.classList.contains('active')) return;
  requestAnimationFrame(() => {
    appState.map?.invalidateSize({ pan: false });
    window.setTimeout(() => appState.map?.invalidateSize({ pan: false }), 120);
  });
}

function setView(view) {
  const isMap = view === 'map';
  const isDesktop = window.matchMedia('(min-width: 860px)').matches;
  elements.tabMap.classList.toggle('active', isMap);
  elements.tabList.classList.toggle('active', !isMap);
  elements.tabMap.setAttribute('aria-selected', String(isMap));
  elements.tabList.setAttribute('aria-selected', String(!isMap));
  elements.mapPanel.classList.toggle('active', isMap);
  elements.listPanel.hidden = isMap && !isDesktop;
  elements.listPanel.classList.toggle('active', !isMap || isDesktop);
  if (isMap) invalidateVisibleMap();
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}
function formatLocationAccuracy(meters) {
  if (!Number.isFinite(meters) || meters < 0) return '';
  return meters < 10 ? `${Math.round(meters)}m` : `${Math.round(meters / 10) * 10}m`;
}

function getAccurateCurrentPosition() {
  return new Promise((resolve, reject) => {
    let watchId = null, timeoutId = null, bestPosition = null, settled = false;
    const finish = (position, error) => {
      if (settled) return;
      settled = true;
      if (timeoutId !== null) clearTimeout(timeoutId);
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      if (position) resolve(position); else reject(error || new Error('현재 위치를 확인하지 못했습니다.'));
    };
    try {
      watchId = navigator.geolocation.watchPosition(position => {
        const accuracy = position.coords.accuracy;
        if (!bestPosition || (Number.isFinite(accuracy) && accuracy < bestPosition.coords.accuracy)) bestPosition = position;
        if (Number.isFinite(accuracy) && accuracy <= 30) finish(position);
      }, error => finish(bestPosition, error), { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
      timeoutId = setTimeout(() => {
        if (bestPosition) finish(bestPosition);
        else { const error = new Error('현재 위치를 확인하는 데 시간이 너무 오래 걸렸습니다.'); error.code = 3; finish(null, error); }
      }, 12000);
    } catch (error) { finish(null, error); }
  });
}

function routeSummary(place) {
  const status = place.routeStatus || 'not-calculated';
  if (status === 'not-calculated') return '<span>TMAP 도보 경로는 장소 선택 시 계산</span>';
  if (status !== 'ok') return `<span class="route-error">${escapeHtml(place.routeError || '도보 경로 요청이 실패했습니다.')}</span>`;
  return `<span>도보 ${escapeHtml(place.routeDistanceText)}</span><span>약 ${escapeHtml(place.routeDurationText)}</span>`;
}

function makePlaceCard(place) {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = `place-card${place.routeStatus === 'error' ? ' route-unavailable' : ''}`;
  card.setAttribute('role', 'listitem');
  const icon = place.category === 'bench' ? '▰' : place.category === 'transit' ? '↔' : place.category === 'picnic' ? '⌑' : place.category === 'park' ? '♧' : '⌂';
  const detailTags = Object.entries(place.details || {}).filter(([key]) => key !== 'name').map(([, value]) => `<span>${escapeHtml(value)}</span>`).slice(0, 3).join('');
  card.innerHTML = `<span class="place-card-top"><span class="place-kind-icon" aria-hidden="true">${icon}</span><span class="place-heading"><span class="place-name">${escapeHtml(place.name)}</span><span class="place-type">${escapeHtml(place.type)}</span></span></span><span class="place-details">${routeSummary(place)}${detailTags}</span>`;
  card.addEventListener('click', () => showPlaceDetail(place));
  return card;
}

function renderPlaces() {
  const places = appState.places;
  elements.placesList.replaceChildren();
  elements.emptyState.hidden = places.length > 0 || appState.isSearching;
  
  if (appState.isSearching) {
    elements.resultsCount.textContent = `현재 ${places.length}개 발견 · 검색 중`;
  } else {
    elements.resultsCount.textContent = `휴식공간 ${places.length}곳 (반경 ${(appState.currentRadius / 1000).toFixed(1)}km)`;
  }
  elements.tabCount.textContent = places.length ? `(${places.length})` : '';
  
  for (const group of [
    { id: 'confirmed', title: '확실한 착석 공간', places: places.filter(place => place.resultGroup !== 'possible') },
    { id: 'possible', title: '휴식 가능 장소 · 착석시설 정보 확인 필요', places: places.filter(place => place.resultGroup === 'possible') }
  ]) {
    if (!group.places.length) continue;
    const heading = document.createElement('h3');
    heading.className = `place-group-title place-group-${group.id}`;
    heading.textContent = `${group.title} (${group.places.length})`;
    elements.placesList.append(heading);
    group.places.forEach(place => elements.placesList.append(makePlaceCard(place)));
  }

  // '더 넓게 검색' 버튼 표시 제어
  if (elements.expandSearchContainer) {
    if (appState.currentRadius < 2000 && !appState.isSearching && appState.userLocation) {
      elements.expandSearchContainer.hidden = false;
      const nextRadius = appState.currentRadius === 1000 ? 1500 : 2000;
      if (elements.expandSearchText) elements.expandSearchText.textContent = `더 넓게 검색 (반경 ${(nextRadius / 1000).toFixed(1)}km)`;
    } else {
      elements.expandSearchContainer.hidden = true;
    }
  }
}

function stopLocationWatch() {
  if (appState.locationWatchId !== null && navigator.geolocation) navigator.geolocation.clearWatch(appState.locationWatchId);
  appState.locationWatchId = null;
  appState.navigationActive = false;
  appState.rerouteInProgress = false;
}
function exitNavigationMode(reopenDetail = false) {
  document.body.classList.remove('navigation-mode');
  if (elements.navPanel.parentElement !== elements.bottomSheet) elements.bottomSheet.insertBefore(elements.navPanel, elements.sheetBody);
  if (reopenDetail) {
    elements.bottomSheet.hidden = false;
    elements.sheetBackdrop.hidden = false;
    requestAnimationFrame(() => elements.bottomSheet.classList.add('open'));
  } else {
    elements.bottomSheet.classList.remove('open');
    elements.bottomSheet.hidden = true;
    elements.sheetBackdrop.hidden = true;
  }
  if (appState.userMarker && appState.map && !appState.map.hasLayer(appState.userMarker)) appState.userMarker.addTo(appState.map);
  if (appState.userAccuracyCircle && appState.map && !appState.map.hasLayer(appState.userAccuracyCircle)) appState.userAccuracyCircle.addTo(appState.map);
  invalidateVisibleMap();
}
function clearNavigation(removeRoute = true) {
  stopLocationWatch();
  if (document.body.classList.contains('navigation-mode')) exitNavigationMode(false);
  appState.routeInfo = null; appState.selectedPlace = null; appState.navigationPosition = null; appState.routeProgressMeters = 0;
  if (appState.navigationMarker) appState.navigationMarker.remove();
  appState.navigationMarker = null;
  if (removeRoute && appState.routeLine) appState.routeLine.remove();
  if (removeRoute) appState.routeLine = null;
  if (elements.navPanel) elements.navPanel.hidden = true;
}
function clearRouteLine() { appState.routeToken += 1; clearNavigation(); }

function renderMarkers() {
  const map = getMap();
  map.invalidateSize({ pan: false });
  appState.markers.forEach(marker => marker.remove());
  appState.markers = [];
  if (appState.userMarker) appState.userMarker.remove();
  if (appState.userAccuracyCircle) appState.userAccuracyCircle.remove();
  appState.userAccuracyCircle = null;
  const accuracy = appState.userLocationAccuracy;
  const accuracyText = Number.isFinite(accuracy) ? `기기 보고 위치 정확도 약 ±${escapeHtml(formatLocationAccuracy(accuracy))} (추정)` : '';
  if (Number.isFinite(accuracy) && accuracy > 0 && accuracy <= 500) {
    appState.userAccuracyCircle = L.circle([appState.userLocation.lat, appState.userLocation.lng], { radius: accuracy, color: '#2878d0', weight: 1, fillColor: '#2878d0', fillOpacity: .1 }).addTo(map);
  }
  const popup = accuracyText ? `내 위치<br><small>${accuracyText}</small>` : '내 위치';
  const heading = window.UserHeading ? window.UserHeading.getHeading() : null;
  if (window.UserHeading) {
    appState.userMarker = L.marker([appState.userLocation.lat, appState.userLocation.lng], {
      icon: window.UserHeading.createUserIcon(heading)
    }).addTo(map).bindPopup(popup);
  } else {
    appState.userMarker = L.circleMarker([appState.userLocation.lat, appState.userLocation.lng], { radius: 8, color: '#fff', weight: 3, fillColor: '#2878d0', fillOpacity: 1 }).addTo(map).bindPopup(popup);
  }
  for (const place of appState.places) {
    const marker = L.marker([place.lat, place.lng]).addTo(map);
    const status = place.routeStatus || 'not-calculated';
    const routeLabel = status === 'ok' ? `도보 ${escapeHtml(place.routeDistanceText)} · 약 ${escapeHtml(place.routeDurationText)}` : status === 'not-calculated' ? 'TMAP 도보 경로는 장소 선택 시 계산' : escapeHtml(place.routeError || '도보 경로 요청이 실패했습니다');
    marker.bindPopup(`<strong>${escapeHtml(place.name)}</strong><br>${escapeHtml(place.type)}<br>${routeLabel}`);
    marker.on('click', () => showPlaceDetail(place));
    appState.markers.push(marker);
  }
  const points = [appState.userMarker, ...appState.markers];
  if (appState.userAccuracyCircle) points.push(appState.userAccuracyCircle);
  if (points.length > 1) map.fitBounds(L.featureGroup(points).getBounds().pad(.12), { maxZoom: 16 });
  else if (appState.userLocation) map.setView([appState.userLocation.lat, appState.userLocation.lng], 16);
  invalidateVisibleMap();
}

function appendDetailRow(label, value) {
  const row = document.createElement('div'); row.className = 'detail-row';
  const labelElement = document.createElement('span'); labelElement.className = 'detail-label'; labelElement.textContent = label;
  const valueElement = document.createElement('span'); valueElement.className = 'detail-value'; valueElement.textContent = value;
  row.append(labelElement, valueElement); elements.sheetBody.append(row);
}
function showRouteError(place, error) {
  elements.sheetBody.replaceChildren(); elements.navPanel.hidden = true;
  appendDetailRow('분류', place.resultGroup === 'possible' ? '휴식 가능 장소 · 착석시설 정보 확인 필요' : '확실한 착석 공간');
  appendDetailRow('도보 경로', '불러오지 못했습니다.');
  appendDetailRow('안내', error?.message || place.routeError || 'TMAP 보행 경로 요청이 실패했습니다.');
  appendDetailRow('종류', place.type); appendDetailRow('데이터 출처', place.source);
}
function renderRouteDetails(place, route) {
  elements.sheetBody.replaceChildren();
  appendDetailRow('분류', place.resultGroup === 'possible' ? '휴식 가능 장소 · 착석시설 정보 확인 필요' : '확실한 착석 공간');
  appendDetailRow('종류', place.type);
  appendDetailRow('도보 거리', Data.formatRouteDistance(route.distanceMeters));
  appendDetailRow('예상 시간', `약 ${Data.formatRouteDuration(route.durationSeconds)}`);
  for (const [, value] of Object.entries(place.details || {}).filter(([key]) => key !== 'name')) appendDetailRow('특징', value);
  appendDetailRow('데이터 출처', `${place.source} · 보행 경로 TMAP Mobility`);
  const title = document.createElement('h3'); title.className = 'directions-title'; title.textContent = '경로 안내'; elements.sheetBody.append(title);
  if (!route.steps.length) {
    const noSteps = document.createElement('p'); noSteps.className = 'directions-empty'; noSteps.textContent = '단계별 안내를 제공하지 않는 경로입니다. 지도 경로선을 확인해 주세요.'; elements.sheetBody.append(noSteps);
  } else {
    const list = document.createElement('ol'); list.className = 'directions-list';
    route.steps.forEach(step => {
      const item = document.createElement('li'); item.className = 'direction-step';
      const instruction = document.createElement('span'); instruction.textContent = step.instruction;
      const stepDistance = document.createElement('small'); stepDistance.textContent = step.distanceMeters > 0 ? Data.formatRouteDistance(step.distanceMeters) : '';
      item.append(instruction, stepDistance); list.append(item);
    });
    elements.sheetBody.append(list);
  }
}
function koreanizeInstruction(instruction) {
  const text = String(instruction || '').trim();
  if (!text) return '경로를 따라 이동하세요';
  const directionNames = { north: '북쪽', south: '남쪽', east: '동쪽', west: '서쪽', northeast: '북동쪽', northwest: '북서쪽', southeast: '남동쪽', southwest: '남서쪽' };
  let match = text.match(/^head\s+(north|south|east|west|north east|north west|south east|south west)(?:\s+on\s+(.+))?$/i);
  if (match) { const direction = directionNames[match[1].toLowerCase().replace(/\s+/g, '')] || '앞쪽'; return match[2] ? `${match[2]} 방면으로 ${direction}으로 이동` : `${direction}으로 이동`; }
  match = text.match(/^turn\s+(slight\s+|sharp\s+)?(left|right)(?:\s+onto\s+(.+))?$/i);
  if (match) { const modifier = match[1]?.trim().toLowerCase(); const side = match[2].toLowerCase() === 'left' ? '좌회전' : '우회전'; const turn = modifier === 'slight' ? `약간 ${side}` : modifier === 'sharp' ? `크게 ${side}` : side; return match[3] ? `${match[3]}로 ${turn}` : turn; }
  match = text.match(/^continue(?:\s+straight)?(?:\s+on\s+(.+))?$/i);
  if (match) return match[1] ? `${match[1]} 방면으로 직진` : '직진';
  if (/^(arrive|you have arrived|destination reached)/i.test(text)) return '목적지에 도착했습니다';
  return text;
}
function getRoutePosition(current) {
  const coordinates = appState.routeInfo.coordinates, cumulative = appState.routeInfo.cumulativeMeters || [];
  const metersPerLat = 110540, metersPerLng = 111320 * Math.cos(current.lat * Math.PI / 180);
  let best = { nearestIndex: 0, nearestDistance: Infinity, routeMeters: 0 };
  for (let index = 0; index < coordinates.length - 1; index += 1) {
    const first = coordinates[index], second = coordinates[index + 1];
    const ax = (first[1] - current.lng) * metersPerLng, ay = (first[0] - current.lat) * metersPerLat;
    const bx = (second[1] - current.lng) * metersPerLng, by = (second[0] - current.lat) * metersPerLat;
    const dx = bx - ax, dy = by - ay, lengthSquared = dx * dx + dy * dy;
    const fraction = lengthSquared ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSquared)) : 0;
    const distance = Math.hypot(ax + fraction * dx, ay + fraction * dy);
    if (distance < best.nearestDistance) {
      const segmentLength = cumulative[index + 1] - cumulative[index];
      best = { nearestIndex: index, nearestDistance: distance, routeMeters: (cumulative[index] || 0) + Math.max(0, segmentLength) * fraction };
    }
  }
  return best;
}
function updateNavigationGuidance(current, routePosition) {
  const route = appState.routeInfo, cumulative = route.cumulativeMeters || [];
  const geometryLength = cumulative[cumulative.length - 1] || route.distanceMeters;
  const progress = Math.min(geometryLength, appState.routeProgressMeters);
  const progressRatio = geometryLength > 0 ? Math.min(1, progress / geometryLength) : 0;
  const remainingDistance = Math.max(0, route.distanceMeters * (1 - progressRatio));
  const remainingDuration = Math.max(0, route.durationSeconds * remainingDistance / route.distanceMeters);
  elements.navRemaining.textContent = `목적지까지 ${Data.formatRouteDistance(remainingDistance)} · 약 ${Data.formatRouteDuration(remainingDuration)}`;
  if (progressRatio >= .98 || routePosition.nearestIndex >= route.coordinates.length - 2) {
    elements.navInstruction.textContent = '목적지에 도착했습니다'; elements.navDistance.textContent = appState.selectedPlace?.name || '';
    elements.navStatus.textContent = '안내 종료를 누르면 장소 상세로 돌아갑니다.'; elements.btnRecalculateRoute.hidden = true; return;
  }
  const nextStep = route.steps.find(step => step.endIndex >= routePosition.nearestIndex && step.endIndex > 0);
  if (!nextStep) { elements.navInstruction.textContent = '경로를 따라 목적지로 이동하세요'; elements.navDistance.textContent = ''; }
  else {
    const distanceToStep = Math.max(0, (cumulative[nextStep.endIndex] ?? progress) - progress);
    const instruction = koreanizeInstruction(nextStep.instruction);
    elements.navInstruction.textContent = distanceToStep > 8 ? `${Data.formatRouteDistance(distanceToStep)} 후 ${instruction}` : instruction;
    elements.navDistance.textContent = distanceToStep > 8 ? '다음 안내' : '지금 방향을 바꾸세요';
  }
  elements.navStatus.textContent = Number.isFinite(current.accuracy) && current.accuracy > 80 ? `GPS 위치 오차가 클 수 있습니다 (기기 보고 약 ±${formatLocationAccuracy(current.accuracy)}).` : '현재 위치를 따라 안내 중.';
  elements.btnRecalculateRoute.hidden = true;
}
function setRouteLine(route) {
  if (appState.routeLine) appState.routeLine.remove();
  appState.routeLine = L.polyline(route.coordinates, { color: '#197c68', weight: 6, opacity: .9, lineCap: 'round', lineJoin: 'round' }).addTo(getMap());
}
function updateFollowButton() {
  elements.btnFollowNavigation.setAttribute('aria-pressed', String(appState.followNavigation));
  elements.btnFollowNavigation.textContent = appState.followNavigation ? '위치 따라가는 중' : '내 위치로 이동';
  elements.btnFollowNavigation.classList.toggle('following', appState.followNavigation);
}
async function recalculateRoute(manual = false) {
  if (!appState.selectedPlace || !appState.navigationPosition || !appState.navigationActive || appState.rerouteInProgress) return;
  const now = Date.now(); if (!manual && now - appState.lastRerouteAt < 15000) return;
  appState.rerouteInProgress = true; appState.lastRerouteAt = now;
  const current = { ...appState.navigationPosition }, destination = { lat: appState.selectedPlace.lat, lng: appState.selectedPlace.lng, name: appState.selectedPlace.name };
  elements.navInstruction.textContent = '현재 위치에서 새 경로를 찾는 중'; elements.navDistance.textContent = 'TMAP 보행 경로 계산 중'; elements.navRemaining.textContent = '';
  elements.navStatus.textContent = '기존 경로선은 새 경로를 받는 동안 유지됩니다.'; elements.btnRecalculateRoute.hidden = true;
  try {
    const route = await Data.requestWalkingRoute({ lat: current.lat, lng: current.lng }, destination);
    if (!appState.navigationActive || !appState.selectedPlace || appState.selectedPlace.lat !== destination.lat || appState.selectedPlace.lng !== destination.lng) return;
    if (!route.coordinates.length || !Number.isFinite(route.distanceMeters) || !Number.isFinite(route.durationSeconds)) throw new Error('TMAP 경로 응답에 유효한 거리·시간 정보가 없습니다.');
    appState.routeInfo = route; appState.routeProgressMeters = 0; setRouteLine(route);
    if (appState.followNavigation) getMap().setView([current.lat, current.lng], Math.max(getMap().getZoom(), 17), { animate: true });
    const routePosition = getRoutePosition(current); appState.routeProgressMeters = routePosition.routeMeters;
    updateNavigationGuidance(current, routePosition); elements.navStatus.textContent = '현재 위치 기준으로 경로를 다시 찾았습니다.';
  } catch (error) {
    console.warn('TMAP 경로 재탐색 실패:', error.message || 'TMAP 요청 실패');
    elements.navInstruction.textContent = '새 도보 경로를 불러오지 못했습니다'; elements.navDistance.textContent = '기존 경로는 현재 위치와 다를 수 있습니다.';
    elements.navRemaining.textContent = '새 경로를 불러온 뒤 남은 거리와 시간을 표시합니다.'; elements.navStatus.textContent = '네트워크와 위치를 확인한 뒤 다시 시도해 주세요.';
    elements.btnRecalculateRoute.hidden = false;
  } finally { appState.rerouteInProgress = false; }
}
function updateNavigationPosition(position) {
  if (!appState.routeInfo || !appState.navigationActive) return;
  const heading = Number.isFinite(position.coords.heading) && position.coords.heading >= 0
    ? position.coords.heading
    : (window.UserHeading ? window.UserHeading.getHeading() : null);
  const current = { lat: position.coords.latitude, lng: position.coords.longitude, accuracy: position.coords.accuracy, heading };
  appState.navigationPosition = current; appState.userLocation = { lat: current.lat, lng: current.lng }; appState.userLocationAccuracy = current.accuracy;
  const routePosition = getRoutePosition(current); appState.routeProgressMeters = Math.max(appState.routeProgressMeters, routePosition.routeMeters);
  
  if (!appState.navigationMarker) {
    if (window.UserHeading) {
      appState.navigationMarker = L.marker([current.lat, current.lng], {
        icon: window.UserHeading.createUserIcon(heading)
      }).addTo(getMap()).bindPopup('현재 위치');
    } else {
      appState.navigationMarker = L.circleMarker([current.lat, current.lng], { radius: 9, color: '#fff', weight: 3, fillColor: '#2878d0', fillOpacity: 1 }).addTo(getMap()).bindPopup('현재 위치');
    }
  } else {
    appState.navigationMarker.setLatLng([current.lat, current.lng]);
    if (window.UserHeading && Number.isFinite(heading)) {
      window.UserHeading.updateUserHeadingDisplay(heading);
    }
  }
  if (appState.followNavigation) getMap().panTo([current.lat, current.lng], { animate: true, duration: .35 });
  if (routePosition.nearestDistance > 70) {
    elements.navInstruction.textContent = '경로에서 벗어났어요'; elements.navDistance.textContent = `경로와 약 ${Data.formatRouteDistance(routePosition.nearestDistance)} 떨어져 있습니다.`;
    elements.navRemaining.textContent = '현재 위치 기준으로 경로를 다시 찾습니다.'; elements.navStatus.textContent = '자동으로 TMAP 보행 경로를 다시 요청하고 있습니다.';
    if (!appState.rerouteInProgress) void recalculateRoute(false); return;
  }
  updateNavigationGuidance(current, routePosition);
}
function enterNavigationMode() {
  if (elements.navPanel.parentElement !== elements.mapPanel) elements.mapPanel.append(elements.navPanel);
  elements.navPanel.hidden = false; elements.bottomSheet.classList.remove('open'); elements.bottomSheet.hidden = true; elements.sheetBackdrop.hidden = true;
  document.body.classList.add('navigation-mode'); appState.followNavigation = true; updateFollowButton();
  if (appState.userMarker) appState.userMarker.remove(); if (appState.userAccuracyCircle) appState.userAccuracyCircle.remove();
  const center = appState.navigationPosition || appState.userLocation;
  if (center) getMap().setView([center.lat, center.lng], 17, { animate: true });
  invalidateVisibleMap(); setTimeout(invalidateVisibleMap, 280);
}
function startNavigation() {
  if (!appState.routeInfo || !appState.selectedPlace) return;
  if (!navigator.geolocation) { elements.navStatus.textContent = '이 브라우저에서는 현재 위치 안내를 사용할 수 없습니다.'; return; }
  if (window.UserHeading) window.UserHeading.initCompass();
  if (appState.locationWatchId !== null) navigator.geolocation.clearWatch(appState.locationWatchId);
  appState.navigationActive = true; appState.navigationPosition = null; appState.routeProgressMeters = 0; appState.lastRerouteAt = 0;
  elements.btnStartNavigation.hidden = true; elements.btnStopNavigation.hidden = false; elements.btnRecalculateRoute.hidden = true;
  elements.navInstruction.textContent = '현재 위치를 확인하고 있습니다'; elements.navDistance.textContent = 'GPS 위치를 기다리는 중';
  elements.navRemaining.textContent = `목적지: ${appState.selectedPlace.name}`; elements.navStatus.textContent = '현재 위치를 따라 지도가 이동합니다.'; enterNavigationMode();
  appState.locationWatchId = navigator.geolocation.watchPosition(updateNavigationPosition, error => {
    if (!appState.navigationActive) return;
    elements.navStatus.textContent = error.code === error.PERMISSION_DENIED ? '위치 권한이 거부되었습니다. 브라우저 설정에서 허용해 주세요.' : '현재 위치를 확인하지 못했습니다. GPS 신호를 확인해 주세요.';
    if (error.code === error.PERMISSION_DENIED) stopLocationWatch();
  }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 1000 });
}
function stopNavigation() {
  const finalPosition = appState.navigationPosition; stopLocationWatch();
  if (finalPosition) {
    appState.userLocation = { lat: finalPosition.lat, lng: finalPosition.lng }; appState.userLocationAccuracy = finalPosition.accuracy;
    if (appState.userMarker) appState.userMarker.setLatLng([finalPosition.lat, finalPosition.lng]);
    if (appState.userAccuracyCircle) { appState.userAccuracyCircle.setLatLng([finalPosition.lat, finalPosition.lng]); if (Number.isFinite(finalPosition.accuracy) && finalPosition.accuracy > 0) appState.userAccuracyCircle.setRadius(finalPosition.accuracy); }
  }
  if (appState.navigationMarker) appState.navigationMarker.remove(); appState.navigationMarker = null; appState.navigationPosition = null;
  if (appState.routeInfo && appState.selectedPlace) {
    renderRouteDetails(appState.selectedPlace, appState.routeInfo); elements.navInstruction.textContent = '안내가 종료되었습니다';
    elements.navDistance.textContent = `${Data.formatRouteDistance(appState.routeInfo.distanceMeters)} · 약 ${Data.formatRouteDuration(appState.routeInfo.durationSeconds)}`;
    elements.navRemaining.textContent = `목적지: ${appState.selectedPlace.name}`;
  }
  if (elements.btnStartNavigation && appState.routeInfo) elements.btnStartNavigation.hidden = false;
  elements.btnStopNavigation.hidden = true; elements.btnRecalculateRoute.hidden = true;
  if (appState.routeInfo) elements.navStatus.textContent = '실시간 위치 추적을 종료했습니다.';
  if (document.body.classList.contains('navigation-mode')) exitNavigationMode(true);
}

async function showPlaceDetail(place) {
  const routeToken = ++appState.routeToken;
  stopLocationWatch(); if (document.body.classList.contains('navigation-mode')) exitNavigationMode(false);
  appState.routeInfo = null; appState.selectedPlace = place; appState.navigationPosition = null; appState.routeProgressMeters = 0;
  if (appState.navigationMarker) appState.navigationMarker.remove(); appState.navigationMarker = null;
  if (appState.routeLine) appState.routeLine.remove(); appState.routeLine = null;
  elements.sheetTitle.textContent = place.name; elements.sheetBody.replaceChildren(); elements.navPanel.hidden = true;
  elements.bottomSheet.hidden = false; elements.sheetBackdrop.hidden = false; requestAnimationFrame(() => elements.bottomSheet.classList.add('open'));
  setView('map'); const map = getMap(); map.panTo([place.lat, place.lng]); invalidateVisibleMap();
  const currentStatus = place.routeStatus || 'not-calculated';
  if (currentStatus === 'not-calculated') {
    Utils.setLoading(true, `${place.name}까지 TMAP 보행 경로를 계산하는 중...`);
    try {
      const route = await Data.requestWalkingRoute(appState.userLocation, { lat: place.lat, lng: place.lng, name: place.name });
      if (routeToken !== appState.routeToken) return;
      place = { ...place, routeDistanceMeters: route.distanceMeters, routeDurationSeconds: route.durationSeconds, routeDistanceText: Data.formatRouteDistance(route.distanceMeters), routeDurationText: Data.formatRouteDuration(route.durationSeconds), routeStatus: 'ok', routeError: null };
      const index = appState.places.findIndex(candidate => candidate.id === place.id); if (index >= 0) appState.places[index] = place;
      renderPlaces(); renderMarkers();
    } catch (error) {
      if (routeToken !== appState.routeToken) return;
      console.warn('선택 장소 TMAP 경로 계산 실패:', error.message || 'TMAP 요청 실패');
      place = { ...place, routeStatus: 'error', routeError: error?.message || 'TMAP 보행 경로 요청이 실패했습니다.' };
      const index = appState.places.findIndex(candidate => candidate.id === place.id); if (index >= 0) appState.places[index] = place;
      renderPlaces(); renderMarkers(); Utils.setLoading(false); showRouteError(place, error); return;
    } finally { if (routeToken === appState.routeToken) Utils.setLoading(false); }
  }
  if (place.routeStatus !== 'ok') { showRouteError(place); return; }
  Utils.setLoading(true, `${place.name}까지 TMAP 보행 길찾기 중...`);
  try {
    const route = await Data.requestWalkingRoute(appState.userLocation, { lat: place.lat, lng: place.lng, name: place.name });
    if (routeToken !== appState.routeToken) return;
    if (!route.coordinates.length || !Number.isFinite(route.distanceMeters) || !Number.isFinite(route.durationSeconds)) throw new Error('TMAP 경로 응답의 거리·시간·좌표 정보가 올바르지 않습니다.');
    appState.routeInfo = route; setRouteLine(route); map.fitBounds(appState.routeLine.getBounds().pad(.18), { maxZoom: 17 });
    renderRouteDetails(place, route); elements.navPanel.hidden = false;
    elements.navInstruction.textContent = '도착지를 확인하고 길 안내를 시작하세요';
    elements.navDistance.textContent = `${Data.formatRouteDistance(route.distanceMeters)} · 약 ${Data.formatRouteDuration(route.durationSeconds)}`;
    elements.navRemaining.textContent = `목적지: ${place.name}`; elements.navStatus.textContent = '안내 시작을 누르면 현재 위치를 따라 한 단계씩 안내합니다.';
    elements.btnStartNavigation.hidden = false; elements.btnStopNavigation.hidden = true; elements.btnRecalculateRoute.hidden = true;
  } catch (error) {
    if (routeToken !== appState.routeToken) return;
    console.error('TMAP 보행 길찾기 실패:', error); if (appState.routeLine) appState.routeLine.remove(); appState.routeLine = null; showRouteError(place, error);
  } finally { if (routeToken === appState.routeToken) Utils.setLoading(false); }
}
function closePlaceDetail() {
  appState.routeToken += 1; Utils.setLoading(false); clearNavigation(); elements.bottomSheet.classList.remove('open'); elements.sheetBackdrop.hidden = true;
  setTimeout(() => { elements.bottomSheet.hidden = true; }, 250);
}
function showPlaceSearchError(error) {
  console.error('[장소 검색] Overpass 실패', { httpStatus: error?.statusCode ?? '상태 없음', stage: error?.stage || '주변 장소 검색' });
  Utils.setLoading(false); Utils.showToast('주변 휴식공간 검색에 실패했습니다. 잠시 후 다시 시도해 주세요.', 'error');
  elements.locationHint.textContent = '주변 장소 검색에 실패했습니다. 네트워크 상태를 확인하고 다시 시도해 주세요.';
}

async function searchAndDisplayPlaces(lat, lng, label = '선택한 위치', accuracy = null, targetRadius = 1000) {
  const token = ++appState.searchToken;
  appState.userLocation = { lat, lng };
  appState.userLocationAccuracy = Number.isFinite(accuracy) ? accuracy : null;
  appState.searchLabel = label;
  appState.currentRadius = targetRadius;
  appState.isSearching = true;
  appState.places = [];
  clearRouteLine();
  
  Utils.setLoading(true, `반경 ${(targetRadius / 1000).toFixed(1)}km에서 휴식공간을 찾는 중...`);
  elements.mainContent.hidden = false;
  elements.locationHint.textContent = `${label} 기준 · 반경 ${(targetRadius / 1000).toFixed(1)}km 착석시설 검색 중...`;
  renderPlaces();

  try {
    const result = await Data.fetchPlacesFromOSM(lat, lng, {
      radiusMeters: targetRadius,
      onProgress: radius => {
        if (token === appState.searchToken) {
          Utils.setLoading(true, `반경 ${(radius / 1000).toFixed(1)}km에서 착석시설과 공원을 찾는 중...`);
        }
      },
      onUpdate: update => {
        if (token !== appState.searchToken) return;
        const deduped = Data.deduplicatePlaces ? Data.deduplicatePlaces(update.places || []) : (update.places || []);
        appState.places = deduped.map(place => ({
          ...place,
          routeStatus: place.routeStatus || 'not-calculated',
          routeError: place.routeError || null
        }));
        
        if (update.isDone) {
          appState.isSearching = false;
        }
        
        renderPlaces();
        renderMarkers();
        setView('map');
        
        const parkCount = appState.places.filter(place => place.category === 'park').length;
        if (appState.isSearching) {
          elements.locationHint.textContent = `${label} 기준 · 현재 ${appState.places.length}개 발견 · 검색 중... (반경 ${(targetRadius / 1000).toFixed(1)}km)`;
        } else {
          const confirmed = appState.places.filter(place => place.resultGroup !== 'possible').length;
          const accuracyText = Number.isFinite(appState.userLocationAccuracy) ? ` · 기기 보고 정확도 약 ±${formatLocationAccuracy(appState.userLocationAccuracy)}(추정)` : '';
          elements.locationHint.textContent = `${label} 기준${accuracyText} · 확실한 착석공간 ${confirmed}곳, 휴식 가능 장소 ${appState.places.length - confirmed}곳 (공원 ${parkCount}곳) 검색 완료.`;
        }
      }
    });

    if (token !== appState.searchToken) return;
    const rawPlaces = Array.isArray(result?.places) ? result.places : [];
    const places = Data.deduplicatePlaces ? Data.deduplicatePlaces(rawPlaces) : rawPlaces;
    appState.places = places.map(place => ({ ...place, routeStatus: 'not-calculated', routeError: null }));
    appState.isSearching = false;
    
    renderPlaces();
    renderMarkers();
    
    const parks = appState.places.filter(place => place.category === 'park').length;
    const confirmed = appState.places.filter(place => place.resultGroup !== 'possible').length;
    const accuracyText = Number.isFinite(appState.userLocationAccuracy) ? ` · 기기 보고 정확도 약 ±${formatLocationAccuracy(appState.userLocationAccuracy)}(추정)` : '';
    elements.locationHint.textContent = `${label} 기준${accuracyText} · 확실한 착석공간 ${confirmed}곳, 휴식 가능 장소 ${appState.places.length - confirmed}곳 (공원 ${parks}곳) 검색 완료.`;
    setView('map');
  } catch (error) {
    if (token === appState.searchToken) {
      appState.isSearching = false;
      renderPlaces();
      showPlaceSearchError(error);
    }
  } finally {
    if (token === appState.searchToken) {
      appState.isSearching = false;
      Utils.setLoading(false);
    }
  }
}

async function expandSearchRadius() {
  if (!appState.userLocation || appState.isSearching) return;
  const nextRadius = appState.currentRadius === 1000 ? 1500 : 2000;
  await searchAndDisplayPlaces(appState.userLocation.lat, appState.userLocation.lng, appState.searchLabel, appState.userLocationAccuracy, nextRadius);
}

async function getCurrentLocation() {
  hideSuggestions();
  if (!navigator.geolocation) { Utils.showToast('이 브라우저에서는 현재 위치를 사용할 수 없습니다. 주소를 검색해 주세요.', 'error'); return; }
  if (window.UserHeading) window.UserHeading.initCompass();
  elements.btnCurrentLocation.disabled = true; Utils.setLoading(true, 'GPS 위치 정확도를 확인하는 중...');
  try {
    const position = await getAccurateCurrentPosition();
    await searchAndDisplayPlaces(position.coords.latitude, position.coords.longitude, '현재 위치', position.coords.accuracy, 1000);
  } catch (error) {
    const message = error.code === 1 ? '위치 권한이 거부되었습니다. 브라우저 설정에서 허용하거나 주소를 검색해 주세요.' : '현재 위치를 가져오지 못했습니다. GPS 신호를 확인하거나 주소를 검색해 주세요.';
    elements.locationHint.textContent = message; Utils.showToast(message, 'error');
  } finally { elements.btnCurrentLocation.disabled = false; Utils.setLoading(false); }
}

// 주소/장소 자동완성 및 추천 리스트 드롭다운 처리
function hideSuggestions() {
  if (!elements.searchSuggestions) return;
  elements.searchSuggestions.hidden = true;
  elements.searchSuggestions.replaceChildren();
  appState.currentSuggestions = [];
  appState.activeSuggestionIndex = -1;
}

function selectSuggestionItem(item) {
  hideSuggestions();
  if (elements.searchInput) elements.searchInput.value = item.name || item.label.split(',')[0];
  searchAndDisplayPlaces(item.lat, item.lng, item.name || item.label.split(',')[0], null, 1000);
}

function renderSuggestions(items) {
  if (!elements.searchSuggestions) return;
  elements.searchSuggestions.replaceChildren();
  appState.currentSuggestions = items;
  appState.activeSuggestionIndex = -1;

  if (!items || !items.length) {
    const empty = document.createElement('div');
    empty.className = 'suggestion-empty';
    empty.textContent = '일치하는 주소나 장소를 찾지 못했습니다.';
    elements.searchSuggestions.append(empty);
    elements.searchSuggestions.hidden = false;
    return;
  }

  items.forEach((item, index) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'search-suggestion-item';
    btn.setAttribute('role', 'option');
    btn.dataset.index = String(index);

    const icon = document.createElement('span');
    icon.className = 'suggestion-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '📍';

    const content = document.createElement('div');
    content.className = 'suggestion-content';

    const title = document.createElement('span');
    title.className = 'suggestion-title';
    title.textContent = item.name || item.label.split(',')[0];

    const desc = document.createElement('span');
    desc.className = 'suggestion-desc';
    desc.textContent = item.label;

    content.append(title, desc);
    btn.append(icon, content);

    btn.addEventListener('mousedown', (e) => {
      e.preventDefault(); // blur 이벤트보다 클릭이 먼저 처리되도록
      selectSuggestionItem(item);
    });

    elements.searchSuggestions.append(btn);
  });

  elements.searchSuggestions.hidden = false;
}

function handleSearchInputChange(event) {
  const query = event.target.value.trim();
  if (appState.suggestionDebounceTimer) clearTimeout(appState.suggestionDebounceTimer);

  if (!query || query.length < 2) {
    hideSuggestions();
    return;
  }

  // 현재 사용자 GPS 위치 또는 현재 지도의 중심 좌표를 기준점으로 전달
  let biasLocation = appState.userLocation;
  if (!biasLocation && appState.map) {
    const center = appState.map.getCenter();
    biasLocation = { lat: center.lat, lng: center.lng };
  }

  appState.suggestionDebounceTimer = setTimeout(async () => {
    try {
      const results = await Data.searchAddress(query, 6, biasLocation);
      if (elements.searchInput.value.trim() === query) {
        renderSuggestions(results);
      }
    } catch (err) {
      console.warn('추천 검색어 조회 실패:', err);
    }
  }, 300);
}

function handleSearchInputKeydown(event) {
  if (!elements.searchSuggestions || elements.searchSuggestions.hidden) return;
  const items = elements.searchSuggestions.querySelectorAll('.search-suggestion-item');
  if (!items.length) return;

  if (event.key === 'ArrowDown') {
    event.preventDefault();
    appState.activeSuggestionIndex = (appState.activeSuggestionIndex + 1) % items.length;
    updateSuggestionHighlight(items);
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    appState.activeSuggestionIndex = (appState.activeSuggestionIndex - 1 + items.length) % items.length;
    updateSuggestionHighlight(items);
  } else if (event.key === 'Enter') {
    if (appState.activeSuggestionIndex >= 0 && appState.activeSuggestionIndex < appState.currentSuggestions.length) {
      event.preventDefault();
      selectSuggestionItem(appState.currentSuggestions[appState.activeSuggestionIndex]);
    }
  } else if (event.key === 'Escape') {
    hideSuggestions();
  }
}

function updateSuggestionHighlight(items) {
  items.forEach((item, index) => {
    const isSelected = index === appState.activeSuggestionIndex;
    item.classList.toggle('highlighted', isSelected);
    if (isSelected) item.scrollIntoView({ block: 'nearest' });
  });
}

async function handleAddressSearch(query) {
  hideSuggestions();
  if (!query.trim()) return;
  Utils.setLoading(true, '주소를 찾는 중...'); let placeSearchStarted = false;
  
  let biasLocation = appState.userLocation;
  if (!biasLocation && appState.map) {
    const center = appState.map.getCenter();
    biasLocation = { lat: center.lat, lng: center.lng };
  }

  try {
    const results = await Data.searchAddress(query.trim(), 1, biasLocation);
    const result = Array.isArray(results) ? results[0] : results;
    if (!result) { Utils.showToast('검색 결과가 없습니다. 다른 주소나 장소명을 입력해 주세요.', 'error'); return; }
    placeSearchStarted = true; await searchAndDisplayPlaces(result.lat, result.lng, (result.name || result.label.split(',')[0]), null, 1000);
  } catch (error) { console.error('주소 검색 실패:', error); Utils.showToast('주소 검색에 실패했습니다. 잠시 후 다시 시도해 주세요.', 'error'); }
  finally { if (!placeSearchStarted) Utils.setLoading(false); }
}

function setupEventListeners() {
  elements.btnCurrentLocation.addEventListener('click', getCurrentLocation);
  elements.searchForm.addEventListener('submit', event => { event.preventDefault(); handleAddressSearch(elements.searchInput.value); });
  
  if (elements.btnExpandSearch) {
    elements.btnExpandSearch.addEventListener('click', expandSearchRadius);
  }

  if (elements.searchInput) {
    elements.searchInput.addEventListener('input', handleSearchInputChange);
    elements.searchInput.addEventListener('keydown', handleSearchInputKeydown);
    elements.searchInput.addEventListener('focus', () => {
      if (elements.searchInput.value.trim().length >= 2 && appState.currentSuggestions.length > 0) {
        elements.searchSuggestions.hidden = false;
      }
    });
    elements.searchInput.addEventListener('blur', () => {
      // 마우스 클릭 이벤트가 처리될 수 있도록 약간의 딜레이 후 닫기
      setTimeout(hideSuggestions, 200);
    });
  }

  document.addEventListener('click', (e) => {
    if (elements.searchSuggestions && !elements.searchSuggestions.contains(e.target) && e.target !== elements.searchInput) {
      hideSuggestions();
    }
  });

  elements.tabMap.addEventListener('click', () => setView('map')); elements.tabList.addEventListener('click', () => setView('list'));
  elements.btnRecenter.addEventListener('click', () => { const center = appState.navigationActive ? appState.navigationPosition : appState.userLocation; if (center) appState.map?.setView([center.lat, center.lng], 16); });
  elements.btnFollowNavigation.addEventListener('click', () => { appState.followNavigation = !appState.followNavigation; updateFollowButton(); if (appState.followNavigation && appState.navigationPosition) appState.map?.setView([appState.navigationPosition.lat, appState.navigationPosition.lng], Math.max(appState.map.getZoom(), 17), { animate: true }); });
  elements.btnCloseSheet.addEventListener('click', closePlaceDetail); elements.sheetBackdrop.addEventListener('click', closePlaceDetail);
  elements.btnStartNavigation.addEventListener('click', startNavigation); elements.btnStopNavigation.addEventListener('click', stopNavigation);
  elements.btnRecalculateRoute.addEventListener('click', () => { void recalculateRoute(true); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !elements.bottomSheet.hidden) closePlaceDetail(); });
  window.addEventListener('resize', () => { if (elements.mainContent.hidden || document.body.classList.contains('navigation-mode')) { invalidateVisibleMap(); return; } setView(elements.tabList.classList.contains('active') ? 'list' : 'map'); });
}
document.addEventListener('DOMContentLoaded', setupEventListeners);
window.app = { searchAndDisplayPlaces, showPlaceDetail, closePlaceDetail, startNavigation, stopNavigation, expandSearchRadius };
