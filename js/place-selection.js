// 목록 카드와 지도 마커가 같은 장소 선택 상태를 공유하도록 연결합니다.
(() => {
  function revealCard(placeId) {
    const listElement = document.getElementById('placesList');
    if (!listElement || placeId == null) return;
    const card = [...listElement.querySelectorAll('[data-place-id]')]
      .find(item => String(item.dataset.placeId) === String(placeId));
    const panel = listElement.closest('.list-panel');
    if (!card || !panel || panel.hidden || !card.getClientRects().length) return;

    const cardRect = card.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const visibleTop = Math.max(panelRect.top, 0);
    const visibleBottom = Math.min(panelRect.bottom, window.innerHeight);
    if (cardRect.top < visibleTop || cardRect.bottom > visibleBottom) {
      card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  function parseCoordinate(value, min, max) {
    if (typeof value !== 'number' && typeof value !== 'string') return null;
    if (typeof value === 'string' && value.trim() === '') return null;
    const coordinate = Number(value);
    if (!Number.isFinite(coordinate) || coordinate < min || coordinate > max) return null;
    return coordinate;
  }

  function focusMapIfNeeded(place) {
    const mapPanel = document.getElementById('mapPanel');
    const map = window.appState?.map;
    if (!map || !mapPanel?.classList.contains('active') || !mapPanel.getClientRects().length) return;

    const lat = parseCoordinate(place?.lat, -90, 90);
    const lng = parseCoordinate(place?.lng, -180, 180);
    if (lat === null || lng === null) return;
    const bounds = map.getContainer().getBoundingClientRect();
    const search = document.querySelector('.location-section').getBoundingClientRect();
    const panel = document.getElementById('listPanel');
    const top = Math.max(0, search.bottom - bounds.top + 20);
    const bottom = panel.classList.contains('active') ? Math.min(bounds.height, panel.getBoundingClientRect().top - bounds.top) : bounds.height;
    const targetY = top + Math.max(40, bottom - top) / 2;
    const zoom = Math.max(17, map.getZoom());
    const point = map.project([lat, lng], zoom);
    const center = point.add([0, bounds.height / 2 - targetY]);
    map.setView(map.unproject(center, zoom), zoom, { animate: true, duration: .35 });
  }

  window.focusSelectedPlace = focusMapIfNeeded;

  function refreshSelection(place, source) {
    window.app?.renderPlaces?.();
    window.app?.renderMarkers?.();
    if (source === 'map') {
      // 지도 탭은 유지해 상세 화면의 경로와 지도를 계속 볼 수 있게 합니다.
      revealCard(place?.id);
    } else if (source === 'list') {
      revealCard(place?.id);
      focusMapIfNeeded(place);
    }
  }

  const appState = window.appState;
  if (!appState || !window.ParkResultsUI || !window.ParkMapMarkers) return;

  const renderCards = window.ParkResultsUI.render;
  window.ParkResultsUI.render = (...args) =>
    renderCards(...args, appState.selectedPlace?.id ?? null);

  const createMarker = window.ParkMapMarkers.createPlaceMarker;
  window.ParkMapMarkers.createPlaceMarker = options => {
    const hasSelection = appState.selectedPlace != null;
    const selected = hasSelection
      && String(appState.selectedPlace.id) === String(options.place?.id);
    const onSelect = options.onSelect;
    return createMarker({
      ...options,
      selected,
      dimmed: hasSelection && !selected,
      onSelect: place => {
        if (typeof onSelect === 'function') onSelect(place);
        window.requestAnimationFrame(() => refreshSelection(place, 'map'));
      }
    });
  };

  // 앱의 기본 클릭 처리보다 먼저 처리해, 선택 후 카드와 마커를 같은 프레임에 갱신합니다.
  document.getElementById('placesList')?.addEventListener('click', event => {
    const card = event.target.closest('[data-place-id]');
    if (!card) return;
    const place = appState.places.find(item => String(item.id) === String(card.dataset.placeId));
    if (!place) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    window.app.showPlaceDetail(place);
    window.requestAnimationFrame(() => refreshSelection(place, 'list'));
  }, true);
})();
