// 디바이스 나침반 및 GPS heading 기반 내 위치 방향 마커
(() => {
  let deviceHeading = null;
  let orientationListenerAttached = false;

  // 방향 각도 계산 헬퍼 (iOS webkitCompassHeading / Android alpha)
  function handleDeviceOrientation(event) {
    let heading = null;
    if (typeof event.webkitCompassHeading === 'number') {
      // iOS Safari (0 = 북쪽, 시계방향)
      heading = event.webkitCompassHeading;
    } else if (event.alpha !== null && typeof event.alpha === 'number') {
      // Android / Standard (alpha: 0 = 북쪽, 반시계방향일 수 있으므로 360 - alpha)
      if (event.absolute === true || event.absolute === undefined) {
        heading = (360 - event.alpha) % 360;
      }
    }
    if (heading !== null && Number.isFinite(heading)) {
      deviceHeading = heading;
      updateUserHeadingDisplay(heading);
    }
  }

  // iOS 13+ 권한 요청 및 이벤트 등록
  async function initCompass() {
    if (orientationListenerAttached) return;
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      try {
        const state = await DeviceOrientationEvent.requestPermission();
        if (state === 'granted') {
          window.addEventListener('deviceorientation', handleDeviceOrientation, true);
          orientationListenerAttached = true;
        }
      } catch (e) {
        console.warn('DeviceOrientation 권한 요청 실패:', e);
      }
    } else if (window.DeviceOrientationEvent) {
      window.addEventListener('deviceorientation', handleDeviceOrientation, true);
      orientationListenerAttached = true;
    }
  }

  // 사용자가 버튼을 누를 때 나침반 권한 요청 트리거
  document.addEventListener('click', () => {
    if (!orientationListenerAttached) initCompass();
  }, { once: true });

  // 방향 빔(시야각)과 가운데 점이 있는 사용자 마커 HTML 생성
  function createUserMarkerHtml(heading) {
    const hasHeading = Number.isFinite(heading);
    const rotation = hasHeading ? heading : 0;
    const beamDisplay = hasHeading ? 'block' : 'none';

    return `
      <div class="user-heading-marker-wrapper" style="transform: rotate(${rotation}deg);">
        <div class="user-heading-beam" style="display: ${beamDisplay};"></div>
        <div class="user-heading-dot"></div>
      </div>
    `;
  }

  // 기존 L.divIcon 생성
  function createUserIcon(heading) {
    return L.divIcon({
      className: 'custom-user-marker-container',
      html: createUserMarkerHtml(heading),
      iconSize: [60, 60],
      iconAnchor: [30, 30]
    });
  }

  // 지도 위의 사용자 마커에 실시간 방향 반영
  function updateUserHeadingDisplay(heading) {
    const marker = appState.navigationMarker || appState.userMarker;
    if (!marker) return;

    // DOM 요소를 직접 회전하여 Leaflet 마커 재생성 비용 절감
    const el = marker.getElement ? marker.getElement() : null;
    if (el) {
      const wrapper = el.querySelector('.user-heading-marker-wrapper');
      const beam = el.querySelector('.user-heading-beam');
      if (wrapper) {
        wrapper.style.transform = `rotate(${heading}deg)`;
      }
      if (beam) {
        beam.style.display = 'block';
      }
    }
  }

  // window 전역으로 내보내기
  window.UserHeading = {
    initCompass,
    getHeading: () => deviceHeading,
    createUserIcon,
    updateUserHeadingDisplay
  };
})();
