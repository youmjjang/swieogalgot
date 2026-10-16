// 휴식공간 목록 카드 HTML을 생성하는 순수 UI 모듈입니다.
(() => {
  const icons = { bench: '🪑', shelter: '🏡', park: '🌳', picnic: '🧺', transit: '🚏', public: '🌿' };

  function render(places, onSelect, getRouteSummary, escapeHtml, selectedPlaceId = null) {
    return places.map(place => {
      const routeStatus = place.routeStatus || 'not-calculated';
      const isSelected = selectedPlaceId != null && String(place.id) === String(selectedPlaceId);
      const seatingNote = place.category !== 'transit' && place.details?.seating && !/착석시설.*확인|좌석.*확인/.test(place.type || '')
        ? '착석시설 정보 확인 필요' : '';
      return `<button class="place-card${routeStatus === 'error' ? ' route-unavailable' : ''}${isSelected ? ' is-selected' : ''}" type="button" role="listitem" data-place-id="${escapeHtml(place.id)}"${isSelected ? ' aria-current="true"' : ''} aria-label="${escapeHtml(place.name)}, ${escapeHtml(place.type)}">
        <span class="place-card-top"><span class="place-kind-icon" aria-hidden="true">${icons[place.category] || '🌿'}</span><span class="place-heading"><span class="place-name">${escapeHtml(place.name)}</span><span class="place-type">${escapeHtml(place.type)}</span></span></span>
        <span class="place-details">${getRouteSummary(place) ? `<span>${escapeHtml(getRouteSummary(place))}</span>` : ''}${seatingNote ? `<span>${escapeHtml(seatingNote)}</span>` : ''}${place.details?.covered ? `<span>${escapeHtml(place.details.covered)}</span>` : ''}${place.details?.backrest ? `<span>${escapeHtml(place.details.backrest)}</span>` : ''}</span>
      </button>`;
    }).join('');
  }

  window.ParkResultsUI = { render };
})();
