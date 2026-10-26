(() => {
  const panel = document.getElementById('listPanel');
  const handle = panel.querySelector('.list-drag-handle');
  const main = panel.parentElement;
  let drag = null, momentum = 0;
  function limits() {
    const available = main.getBoundingClientRect().height;
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
    const mainHeight = main.getBoundingClientRect().height;
    main.classList.toggle('list-covers-half', height > 0 && height >= mainHeight * .5);
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
  panel.addEventListener('pointerdown', event => {
    const zone = event.target.closest('.list-drag-handle, .results-header');
    if (!zone || !panel.contains(zone)) return;
    if (event.button !== 0 || !event.isPrimary) return;
    stop();
    drag = { id: event.pointerId, y: event.clientY, height: panel.getBoundingClientRect().height, lastY: event.clientY, time: event.timeStamp, velocity: 0, samples: [{ y: event.clientY, time: event.timeStamp }], moved: false };
    panel.setPointerCapture(event.pointerId);
  });
  panel.addEventListener('pointermove', event => {
    if (!drag || drag.id !== event.pointerId) return;
    const delta = drag.y - event.clientY;
    if (Math.abs(delta) > 3) drag.moved = true;
    if (!drag.moved) return;
    drag.samples.push({ y: event.clientY, time: event.timeStamp });
    drag.samples = drag.samples.filter(sample => event.timeStamp - sample.time <= 100);
    const first = drag.samples[0];
    drag.velocity = (first.y - event.clientY) / Math.max(1, event.timeStamp - first.time);
    drag.lastY = event.clientY; drag.time = event.timeStamp;
    setHeight(drag.height + delta);
  });
  panel.addEventListener('pointerup', event => {
    if (!drag || drag.id !== event.pointerId) return;
    const moved = drag.moved;
    let velocity = event.timeStamp - drag.time > 120 ? 0 : Math.max(-3.5, Math.min(3.5, drag.velocity * 1.15));
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
      velocity *= Math.pow(.94, dt / 16);
      if (Math.abs(velocity) > .025 && Math.abs(next - current) > .1) momentum = requestAnimationFrame(glide);
      else momentum = 0;
    }
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (Math.abs(velocity) >= .18) {
      // 의도적으로 멈춘 경우가 아니라면 쓸어 올린 방향의 끝까지 이동합니다.
      const start = panel.getBoundingClientRect().height;
      const target = velocity > 0 ? limits().max : limits().min;
      if (reducedMotion) { setHeight(target); return; }
      const started = performance.now();
      const duration = Math.max(240, Math.min(420, Math.abs(target - start) / Math.max(.8, Math.abs(velocity))));
      function finishFlick(now) {
        const progress = Math.min(1, (now - started) / duration);
        const eased = 1 - Math.pow(1 - progress, 3);
        setHeight(start + (target - start) * eased);
        if (progress < 1) momentum = requestAnimationFrame(finishFlick);
        else momentum = 0;
      }
      momentum = requestAnimationFrame(finishFlick);
    } else if (!reducedMotion && Math.abs(velocity) > .05) {
      momentum = requestAnimationFrame(glide);
    }
  });
  const cancel = () => { drag = null; stop(); };
  panel.addEventListener('pointercancel', cancel);
  panel.addEventListener('lostpointercapture', () => { drag = null; });
  handle.addEventListener('keydown', event => {
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); stop();
    const { min, max } = limits();
    setHeight(event.key === 'Home' ? min : event.key === 'End' ? max : panel.getBoundingClientRect().height + (event.key === 'ArrowUp' ? 40 : -40));
  });
})();
