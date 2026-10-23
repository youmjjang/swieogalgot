// 스크롤 방향에 맞춰 로고 영역을 접고 펼칩니다.
(() => {
  const body = document.body;
  const header = document.querySelector('.header');
  const list = document.getElementById('listPanel');
  if (!header || !list) return;
  const blocked = () => body.classList.contains('navigation-mode') || body.classList.contains('search-route-mode') || document.getElementById('bottomSheet').classList.contains('open');
  function direction(delta) {
    if (blocked() || Math.abs(delta) < 8) return;
    body.classList.toggle('header-collapsed', delta > 0);
  }
  // 휠을 아래로 굴리거나 손가락을 위로 밀면 접습니다.
  document.addEventListener('wheel', event => {
    if (event.ctrlKey || event.target.closest('.search-suggestions, .bottom-sheet, input')) return;
    direction(event.deltaY);
  }, { passive: true, capture: true });
  let lastY = null;
  document.addEventListener('touchstart', event => {
    lastY = event.touches.length === 1 && !event.target.closest('input, button, .search-suggestions, .bottom-sheet') ? event.touches[0].clientY : null;
  }, { passive: true, capture: true });
  document.addEventListener('touchmove', event => {
    if (lastY === null || event.touches.length !== 1) return;
    const next = event.touches[0].clientY;
    if (Math.abs(lastY - next) < 16) return;
    direction(lastY - next);
    lastY = next;
  }, { passive: true, capture: true });
  document.addEventListener('touchend', () => { lastY = null; }, { passive: true, capture: true });
  document.addEventListener('touchcancel', () => { lastY = null; }, { passive: true, capture: true });
  let previousScroll = 0;
  list.addEventListener('scroll', () => {
    direction(list.scrollTop - previousScroll);
    previousScroll = list.scrollTop;
  }, { passive: true, capture: true });
  document.getElementById('searchInput').addEventListener('focus', () => body.classList.remove('header-collapsed'));
  header.addEventListener('transitionend', event => {
    if (event.target === header) window.appState?.map?.invalidateSize({ pan: false });
  });
})();
