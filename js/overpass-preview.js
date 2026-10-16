// 장소 검색 진행·완료 상태를 검색 안내 문구와 연결합니다.
(() => {
  window.addEventListener('overpass:search-start', event => {
    const hint = document.getElementById('locationHint');
    if (hint && window.appState?.searchLabel) hint.textContent = `${window.appState.searchLabel} 주변 장소를 조회하고 있습니다...`;
  });
  window.addEventListener('overpass:search-done', event => {
    // Keep a partial-failure notice published by the combined data search.
    if (event.detail?.hasPartialFailure || event.detail?.allFailed) return;
    const hint = document.getElementById('locationHint');
    const count = window.appState?.places?.length || 0;
    if (hint && count) hint.textContent = `${window.appState.searchLabel} 주변 장소 ${count}곳을 표시했습니다.`;
  });
})();
