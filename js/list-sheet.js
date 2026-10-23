(() => {
  const panel = document.getElementById('listPanel');
  const handle = panel.querySelector('.list-drag-handle');
  let drag = null;
  let suppressClick = false;
  const sizes = ['peek', 'half', 'expanded'];
  function size(value) { panel.dataset.size = value; panel.style.removeProperty('height'); }
  handle.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    drag = { y: event.clientY, height: panel.getBoundingClientRect().height, moved: false };
    handle.setPointerCapture(event.pointerId);
  });
  handle.addEventListener('pointermove', event => {
    if (!drag) return;
    const delta = drag.y - event.clientY;
    if (Math.abs(delta) > 6) drag.moved = true;
    if (!drag.moved) return;
    const mainHeight = panel.parentElement.getBoundingClientRect().height;
    panel.style.height = Math.max(150, Math.min(mainHeight, drag.height + delta)) + 'px';
  });
  handle.addEventListener('pointerup', event => {
    if (!drag) return;
    const delta = drag.y - event.clientY;
    suppressClick = drag.moved;
    if (drag.moved) {
      const current = sizes.indexOf(panel.dataset.size || 'half');
      size(sizes[Math.max(0, Math.min(2, current + (delta > 35 ? 1 : delta < -35 ? -1 : 0)))]);
    }
    drag = null;
    panel.style.removeProperty('height');
  });
  handle.addEventListener('pointercancel', () => { drag = null; panel.style.removeProperty('height'); });
  handle.addEventListener('click', () => {
    if (suppressClick) { suppressClick = false; return; }
    size(panel.dataset.size === 'expanded' ? 'half' : 'expanded');
  });
  handle.addEventListener('keydown', event => {
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); size(event.key === 'ArrowUp' ? 'expanded' : 'peek'); }
  });
})();
