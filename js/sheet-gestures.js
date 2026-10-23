// 내용 맨 위에서 아래로 당겨 상세 창을 닫습니다.
(() => {
  const sheet = document.getElementById('bottomSheet');
  if (!sheet) return;
  let gesture = null;
  const reset = () => {
    gesture = null;
    sheet.style.removeProperty('transition');
    sheet.style.removeProperty('transform');
  };
  sheet.addEventListener('touchstart', event => {
    reset();
    if (event.touches.length !== 1 || sheet.scrollTop > 0 || !sheet.classList.contains('open')) return;
    if (event.target.closest('button, a, input, select, textarea')) return;
    const touch = event.touches[0];
    gesture = { x: touch.clientX, y: touch.clientY, distance: 0, dragging: false };
  }, { passive: true });
  sheet.addEventListener('touchmove', event => {
    if (!gesture) return;
    if (event.touches.length !== 1) { reset(); return; }
    const dx = event.touches[0].clientX - gesture.x;
    const dy = event.touches[0].clientY - gesture.y;
    if (!gesture.dragging) {
      if (dy < -8 || Math.abs(dx) > Math.max(12, Math.abs(dy)) || sheet.scrollTop > 0) { reset(); return; }
      if (dy < 8) return;
      gesture.dragging = true;
    }
    if (event.cancelable) event.preventDefault();
    gesture.distance = Math.max(0, dy);
    sheet.style.transition = 'none';
    sheet.style.transform = 'translateY(' + gesture.distance + 'px)';
  }, { passive: false });
  sheet.addEventListener('touchend', () => {
    const shouldClose = gesture?.dragging && gesture.distance >= 80;
    // 닫기 함수가 기존 X 버튼과 동일한 정리 작업을 수행합니다.
    if (shouldClose) {
      if (window.UnifiedPlacePanel) window.UnifiedPlacePanel.back('peek');
      else window.app.closePlaceDetail();
    }
    reset();
  });
  sheet.addEventListener('touchcancel', reset);
})();
