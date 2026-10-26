(() => {
  const panel = document.getElementById('listPanel');
  const handle = panel.querySelector('.list-drag-handle');
  const main = panel.parentElement;
  let drag = null, momentum = 0;
  function limits() {
    const available = main.getBoundingClientRect().height - (parseFloat(main.style.getPropertyValue('--list-top')) || 150);
    return { min: Math.min(110, available), max: Math.max(0, available) };
  }
  function setHeight(value) {
    const { min, max } = limits();
    const height = Math.max(min, Math.min(max, value));
    panel.dataset.size = 'free';
    panel.style.height = height + 'px';
    handle.setAttribute('aria-valuenow', Math.round(height));
    return height;
  }
  const stop = () => { cancelAnimationFrame(momentum); momentum = 0; };
  const syncControls = () => {
    const height = panel.classList.contains('active') ? panel.getBoundingClientRect().height : 0;
    main.style.setProperty('--list-overlay-height', height + 'px');
    handle.setAttribute('aria-valuemin', Math.round(limits().min));
    handle.setAttribute('aria-valuemax', Math.round(limits().max));
    handle.setAttribute('aria-valuenow', Math.round(height));
  };
  const observer = new ResizeObserver(syncControls);
  observer.observe(panel); observer.observe(main);
  new MutationObserver(() => { stop(); syncControls(); }).observe(panel, { attributes: true, attributeFilter: ['class', 'hidden'] });
  syncControls();
  handle.setAttribute('role', 'separator');
  handle.setAttribute('aria-orientation', 'horizontal');
  handle.setAttribute('aria-label', '목록 높이 조절');
  handle.title = '위아래로 자유롭게 끌어 높이 조절';
  handle.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !event.isPrimary) return;
    stop();
    drag = { id: event.pointerId, y: event.clientY, height: panel.getBoundingClientRect().height, lastY: event.clientY, time: event.timeStamp, velocity: 0, moved: false };
    handle.setPointerCapture(event.pointerId);
  });
  handle.addEventListener('pointermove', event => {
    if (!drag || drag.id !== event.pointerId) return;
    const delta = drag.y - event.clientY;
    if (Math.abs(delta) > 3) drag.moved = true;
    if (!drag.moved) return;
    const dt = Math.max(1, event.timeStamp - drag.time);
    drag.velocity = (drag.lastY - event.clientY) / dt;
    drag.lastY = event.clientY; drag.time = event.timeStamp;
    setHeight(drag.height + delta);
  });
  handle.addEventListener('pointerup', event => {
    if (!drag || drag.id !== event.pointerId) return;
    const moved = drag.moved;
    let velocity = event.timeStamp - drag.time > 90 ? 0 : Math.max(-1.5, Math.min(1.5, drag.velocity));
    drag = null;
    if (!moved) return;
    if (!document.body.classList.contains('place-detail-open')) {
      window.appState.view = 'list'; window.PanelHistory?.record('list');
    }
    // 빠르게 놓으면 조금 더 움직이며 부드럽게 멈춥니다. 정해진 높이로 붙지 않습니다.
    let previous = performance.now();
    function glide(now) {
      const dt = Math.min(32, now - previous); previous = now;
      const current = panel.getBoundingClientRect().height;
      const next = setHeight(current + velocity * dt);
      velocity *= Math.pow(.86, dt / 16);
      if (Math.abs(velocity) > .025 && Math.abs(next - current) > .1) momentum = requestAnimationFrame(glide);
      else momentum = 0;
    }
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches && Math.abs(velocity) > .05) momentum = requestAnimationFrame(glide);
  });
  const cancel = () => { drag = null; stop(); };
  handle.addEventListener('pointercancel', cancel);
  handle.addEventListener('lostpointercapture', () => { drag = null; });
  handle.addEventListener('keydown', event => {
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); stop();
    const { min, max } = limits();
    setHeight(event.key === 'Home' ? min : event.key === 'End' ? max : panel.getBoundingClientRect().height + (event.key === 'ArrowUp' ? 40 : -40));
  });
})();
