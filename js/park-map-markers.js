// Leaflet의 휴식공간 마커를 생성합니다. 현재 위치와 검색 출발점 마커는 앱이 별도로 관리합니다.
(() => {
  function parseCoordinate(value, min, max) {
    // null, undefined, 빈 문자열은 Number()에서 0이 되므로 변환 전에 제외합니다.
    if (typeof value !== 'number' && typeof value !== 'string') return null;
    if (typeof value === 'string' && value.trim() === '') return null;

    const coordinate = Number(value);
    if (!Number.isFinite(coordinate) || coordinate < min || coordinate > max) return null;
    return coordinate;
  }

  function createPlaceMarker({ map, place, onSelect, escapeHtml, routeSummary, selected = false, dimmed = false }) {
    if (!map || !place) return null;

    const lat = parseCoordinate(place.lat, -90, 90);
    const lng = parseCoordinate(place.lng, -180, 180);
    if (lat === null || lng === null) return null;

    const markerClasses = [
      'place-marker-pin',
      place.category === 'transit' ? 'pin-transit' : 'pin-rest',
      selected ? 'is-selected' : '',
      dimmed ? 'is-dimmed' : ''
    ].filter(Boolean).join(' ');
    const symbol = place.category === 'transit'
      ? '<rect x="10" y="8" width="16" height="19" rx="4" fill="white"/><rect x="12.5" y="12" width="11" height="7" rx="1.5" fill="currentColor"/><rect x="15" y="9.5" width="6" height="1.3" rx=".65" fill="currentColor"/><circle cx="13.5" cy="23" r="1.4" fill="currentColor"/><circle cx="22.5" cy="23" r="1.4" fill="currentColor"/><path d="M12 27v2m12-2v2M8 13v6m20-6v6" stroke="white" stroke-width="2.2" stroke-linecap="round"/>'
      : '<rect x="9" y="10" width="18" height="4" rx="1.8" fill="white"/><rect x="9" y="15.5" width="18" height="3.5" rx="1.5" fill="white"/><path d="M8 23h20M11 23v6m14-6v6M12 19v4m12-4v4" stroke="white" stroke-width="2.6" stroke-linecap="round"/>';
    const pin = '<svg viewBox="0 0 36 42" aria-hidden="true"><path fill="currentColor" d="M18 1C8.8 1 2 7.6 2 16.7c0 8.9 10.4 18.5 14.2 22.6a2.4 2.4 0 0 0 3.6 0C23.6 35.2 34 25.6 34 16.7 34 7.6 27.2 1 18 1Z"/>' + symbol + '</svg>';
    const icon = L.divIcon({
      className: 'place-marker',
      html: `<span class="${markerClasses}" aria-hidden="true">${pin}</span>`,
      iconSize: [32, 38],
      iconAnchor: [16, 37]
    });
    const marker = L.marker([lat, lng], {
      icon,
      title: place.name || '휴식공간',
      alt: `${place.name || '휴식공간'}. 눌러 상세 정보 보기`,
      keyboard: true,
      riseOnHover: true,
      zIndexOffset: selected ? 400 : 100
    }).addTo(map);

    const summary = typeof routeSummary === 'function' ? routeSummary(place) : '';
    const detail = [place.type, summary].filter(Boolean).map(value => escapeHtml(value)).join('<br>');
    marker.bindTooltip(
      `<strong>${escapeHtml(place.name || '휴식공간')}</strong>${detail ? `<br>${detail}` : ''}`,
      { direction: 'top', offset: [0, -26], opacity: 0.96 }
    );
    marker.on('click', event => {
      if (event?.originalEvent) L.DomEvent.stopPropagation(event.originalEvent);
      if (typeof onSelect === 'function') onSelect(place);
    });
    return marker;
  }

  window.ParkMapMarkers = { createPlaceMarker };
})();
