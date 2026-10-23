// 로고를 누르면 내 위치 주변의 첫 지도 화면으로 돌아갑니다.
(() => {
  const home = document.querySelector('.brand-home');
  if (!home) return;
  home.addEventListener('click', event => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    const app = window.app;
    const state = window.appState;
    if (!app || !state) return;
    window.PanelHistory?.record('map');
    if (state.navigationActive) app.stopNavigation(false);
    if (state.selectedPlace || state.routeViewerActive) app.closePlaceDetail();
    document.body.classList.remove('header-collapsed');
    document.getElementById('searchInput').value = '';
    document.getElementById('tabMap').click();
    const location = state.userLocation;
    if (location && Number.isFinite(location.lat) && Number.isFinite(location.lng)) {
      void app.searchAndDisplayPlaces(location.lat, location.lng, '내 위치', state.userLocationAccuracy, 1000, true);
    } else {
      void app.getCurrentLocation();
    }
  });
})();
