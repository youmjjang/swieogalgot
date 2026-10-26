// 정상 검색 완료 문구는 목록 개수와 중복되므로 숨깁니다.
(() => {
  const hint = document.getElementById('locationHint');
  if (!hint) return;
  const update = () => {
    const text = hint.textContent.trim();
    const routine = /주변 장소(?:\s*\d+곳)?(?:을|를)\s*표시했(?:습니다|어요)\.?$/.test(text);
    hint.hidden = !text || routine;
  };
  new MutationObserver(update).observe(hint, { childList: true, characterData: true, subtree: true });
  update();
})();
