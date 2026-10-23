// 브라우저 뒤로 가기를 지도 → 목록 → 상세 화면 단계와 연결합니다.
(() => {
  const key = 'swieogalgotPanel';
  let restoring = false;
  const state = () => history.state?.[key];
  function write(view, id, replace = false) {
    const next = { ...(history.state || {}), [key]: { view, id: id == null ? null : String(id) } };
    history[replace ? 'replaceState' : 'pushState'](next, '', location.href);
  }
  write('map', null, true);
  window.PanelHistory = {
    record(view, place) {
      if (restoring) return;
      const current = state();
      const id = place?.id == null ? null : String(place.id);
      if (current?.view === view && current.id === id) return;
      if (view === 'detail' && current?.view === 'map') write('list');
      write(view, id);
    }
  };
  window.addEventListener('popstate', event => {
    const target = event.state?.[key];
    if (!target) return;
    restoring = true;
    try {
      const app = window.app;
      if (window.appState.navigationActive) app.stopNavigation(false);
      if (target.view === 'detail') {
        const place = window.appState.places.find(item => String(item.id) === target.id);
        if (place) { void app.showPlaceDetail(place); return; }
      }
      if (document.body.classList.contains('place-detail-open')) {
        if (target.view === 'list') window.UnifiedPlacePanel.back();
        else app.closePlaceDetail();
      }
      document.getElementById(target.view === 'list' ? 'tabList' : 'tabMap').click();
    } finally { restoring = false; }
  });
  // 화면 내부 뒤로/닫기도 기존 방문 기록을 소비해 중복 단계를 만들지 않습니다.
  document.addEventListener('click', event => {
    if (restoring) return;
    const button = event.target.closest('button');
    if (!button) return;
    const current = state();
    const detail = current?.view === 'detail';
    let steps = 0;
    if (detail && (button.matches('.btn-back-list') || button.id === 'tabList')) steps = -1;
    if ((detail || current?.view === 'list') && (button.id === 'tabMap' || button.id === 'btnCloseSheet')) steps = detail ? -2 : -1;
    if (!steps) return;
    event.preventDefault(); event.stopImmediatePropagation();
    history.go(steps);
  }, true);
})();
