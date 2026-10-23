(() => {
  const panel = document.getElementById('listPanel');
  const detail = document.getElementById('bottomSheet');
  const content = panel.querySelector('.list-scroll-content');
  const back = document.createElement('button');
  back.type = 'button'; back.className = 'btn-back-list'; back.textContent = '← 목록';
  detail.querySelector('.sheet-header').before(back);
  panel.append(detail);
  detail.setAttribute('aria-modal', 'false');
  let snapshot = { size: 'half', scroll: 0 };
  let returning = false;
  window.UnifiedPlacePanel = {
    open() {
      window.PanelHistory?.record('detail', window.appState.selectedPlace);
      if (!document.body.classList.contains('place-detail-open')) snapshot = { size: panel.dataset.size || 'half', scroll: content.scrollTop };
      document.body.classList.add('place-detail-open', 'list-open');
      panel.classList.add('active'); panel.hidden = false;
      panel.dataset.size = snapshot.size === 'peek' ? 'half' : snapshot.size;
      detail.scrollTop = 0;
      document.getElementById('tabMap').classList.remove('active');
      document.getElementById('tabList').classList.add('active');
      document.getElementById('tabMap').setAttribute('aria-selected', 'false');
      document.getElementById('tabList').setAttribute('aria-selected', 'true');
      window.appState.view = 'list';
    },
    close() {
      document.body.classList.remove('place-detail-open');
      if (!returning) document.getElementById('tabMap').click();
    },
    back(size) {
      returning = true;
      window.app.closePlaceDetail();
      returning = false;
      document.getElementById('tabList').click();
      panel.dataset.size = size || snapshot.size;
      content.scrollTop = snapshot.scroll;
      window.requestAnimationFrame(() => { content.scrollTop = snapshot.scroll; });
    }
  };
  back.addEventListener('click', () => window.UnifiedPlacePanel.back());
  document.getElementById('tabMap').addEventListener('click', () => {
    if (!document.body.classList.contains('place-detail-open')) return;
    returning = true; window.app.closePlaceDetail(); returning = false;
  });
  document.getElementById('tabList').addEventListener('click', () => {
    if (document.body.classList.contains('place-detail-open')) window.UnifiedPlacePanel.back();
  });
})();
