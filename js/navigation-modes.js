// 검색 경로·GPS 안내에서는 지도와 안내 패널을 함께 표시합니다.
(() => {
  let anchor = null, scrollPosition = 0;
  function enter(mode) {
    const panel = document.getElementById('navPanel');
    if (!document.body.classList.contains('navigation-mode') && !document.body.classList.contains('search-route-mode')) scrollPosition = window.scrollY;
    if (!anchor) { anchor = document.createComment('navigation-panel'); panel.before(anchor); }
    document.body.append(panel);
    document.getElementById('sheetBackdrop').hidden = true;
    document.body.classList.toggle('navigation-mode', mode === 'live');
    document.body.classList.toggle('search-route-mode', mode === 'search');
    window.scrollTo(0, 0);
    window.requestAnimationFrame(() => window.appState?.map?.invalidateSize({ pan: false }));
  }
  function exit() {
    const hadMode = document.body.classList.contains('navigation-mode') || document.body.classList.contains('search-route-mode');
    const panel = document.getElementById('navPanel');
    if (anchor) anchor.after(panel);
    document.body.classList.remove('navigation-mode', 'search-route-mode');
    if (window.appState?.selectedPlace) document.getElementById('sheetBackdrop').hidden = false;
    if (hadMode) window.requestAnimationFrame(() => { window.scrollTo(0, scrollPosition); window.appState?.map?.invalidateSize({ pan: false }); });
  }
  window.NavigationModes = { enterLive: () => enter('live'), exitLive: exit, enterSearchViewer: () => enter('search'), exitSearchViewer: exit };
})();
