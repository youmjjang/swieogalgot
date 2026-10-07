// 결과 마커 갱신은 선택된 장소와 TMAP 경로 상태를 지우지 않습니다.
// 공원처럼 경로를 장소 선택 시 계산하는 후보를 눌렀을 때 기존 상세/TMAP 흐름을 보존합니다.
(() => {
  window.renderMarkers = function renderMarkersPreservingRoute() {
    const map = getMap();
    map.invalidateSize({ pan: false });
    appState.markers.forEach(marker => marker.remove());
    appState.markers = [];
    if (appState.userMarker) appState.userMarker.remove();
    if (appState.userAccuracyCircle) appState.userAccuracyCircle.remove();
    appState.userAccuracyCircle = null;

    const accuracy = appState.userLocationAccuracy;
    const accuracyText = Number.isFinite(accuracy)
      ? `기기 보고 위치 정확도 약 ±${escapeHtml(formatLocationAccuracy(accuracy))} (추정)`
      : '';
    if (Number.isFinite(accuracy) && accuracy > 0 && accuracy <= 500) {
      appState.userAccuracyCircle = L.circle([appState.userLocation.lat, appState.userLocation.lng], {
        radius: accuracy,
        color: '#2878d0',
        weight: 1,
        fillColor: '#2878d0',
        fillOpacity: 0.1
      }).addTo(map);
    }

    const popup = accuracyText ? `내 위치<br><small>${accuracyText}</small>` : '내 위치';
    const heading = window.UserHeading ? window.UserHeading.getHeading() : null;
    if (window.UserHeading) {
      appState.userMarker = L.marker([appState.userLocation.lat, appState.userLocation.lng], {
        icon: window.UserHeading.createUserIcon(heading)
      }).addTo(map).bindPopup(popup);
    } else {
      appState.userMarker = L.circleMarker([appState.userLocation.lat, appState.userLocation.lng], {
        radius: 8, color: '#ffffff', weight: 3, fillColor: '#2878d0', fillOpacity: 1
      }).addTo(map).bindPopup(popup);
    }

    for (const place of appState.places) {
      const marker = L.marker([place.lat, place.lng]).addTo(map);
      const routeLabel = place.routeStatus === 'ok'
        ? `도보 ${escapeHtml(place.routeDistanceText)} · 약 ${escapeHtml(place.routeDurationText)}`
        : place.routeStatus === 'not-calculated'
          ? 'TMAP 도보 경로는 장소 선택 시 계산'
          : escapeHtml(place.routeError || '도보 경로를 불러오지 못했습니다');
      marker.bindPopup(`<strong>${escapeHtml(place.name)}</strong><br>${escapeHtml(place.type)}<br>${routeLabel}`);
      marker.on('click', () => showPlaceDetail(place));
      appState.markers.push(marker);
    }

    const points = [appState.userMarker, ...appState.markers];
    if (appState.userAccuracyCircle) points.push(appState.userAccuracyCircle);
    if (points.length > 1) map.fitBounds(L.featureGroup(points).getBounds().pad(0.12), { maxZoom: 16 });
    else map.setView([appState.userLocation.lat, appState.userLocation.lng], 16);
    invalidateVisibleMap();
  };
})();
