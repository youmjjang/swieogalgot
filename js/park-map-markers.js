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
      selected ? 'is-selected' : '',
      dimmed ? 'is-dimmed' : ''
    ].filter(Boolean).join(' ');
    const pinImage = place.category === 'transit' ? '/images/pin-bus-stop.png' : '/images/pin-bench.png';
    const icon = L.divIcon({
      className: 'place-marker',
      html: `<img class="${markerClasses}" src="${pinImage}" alt="" aria-hidden="true" draggable="false">`,
      iconSize: [48, 52],
      iconAnchor: [26, 48]
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
      { direction: 'top', offset: [0, -34], opacity: 0.96 }
    );
    marker.on('click', event => {
      if (event?.originalEvent) L.DomEvent.stopPropagation(event.originalEvent);
      if (typeof onSelect === 'function') onSelect(place);
    });
    return marker;
  }

  window.ParkMapMarkers = { createPlaceMarker };
})();
