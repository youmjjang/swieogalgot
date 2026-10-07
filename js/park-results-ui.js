// 미계산 후보도 결과 목록에 보존하고, 사용자가 선택한 경우에만 TMAP 경로를 추가 계산합니다.
(() => {
  const originalRouteSummary = window.routeSummary;
  const originalShowPlaceDetail = window.showPlaceDetail;
  const originalShowRouteError = window.showRouteError;
  if (typeof originalRouteSummary !== 'function' || typeof originalShowPlaceDetail !== 'function') return;

  window.routeSummary = function routeSummaryWithDeferredCandidates(place) {
    if (place.routeStatus === 'not-calculated') {
      return '<span>TMAP 도보 경로는 장소 선택 시 계산</span>';
    }
    if (place.routeStatus === 'error') {
      const message = place.routeError || '도보 경로 요청이 실패했습니다.';
      return `<span class="route-error">${escapeHtml(message)}</span>`;
    }
    return originalRouteSummary(place);
  };

  // 오류 상태도 종료 조건으로 취급하지 않고 선택할 때마다 새 TMAP 요청을 보냅니다.
  window.showPlaceDetail = async function showPlaceDetailWithDeferredRoute(place) {
    if (place.routeStatus !== 'not-calculated' && place.routeStatus !== 'error') {
      return originalShowPlaceDetail(place);
    }

    Utils.setLoading(true, `${place.name}까지 TMAP 보행 경로를 계산하는 중...`);
    try {
      const route = await Data.requestWalkingRoute(
        appState.userLocation,
        { lat: place.lat, lng: place.lng, name: place.name }
      );
      const routedPlace = {
        ...place,
        routeDistanceMeters: route.distanceMeters,
        routeDurationSeconds: route.durationSeconds,
        routeDistanceText: Data.formatRouteDistance(route.distanceMeters),
        routeDurationText: Data.formatRouteDuration(route.durationSeconds),
        routeStatus: 'ok',
        routeError: null
      };
      replacePlace(routedPlace);
      return originalShowPlaceDetail(routedPlace);
    } catch (error) {
      const actualMessage = error?.message || 'TMAP 보행 경로 요청이 실패했습니다.';
      console.warn('선택 장소 TMAP 경로 계산 실패:', actualMessage);
      const failedPlace = {
        ...place,
        routeStatus: 'error',
        routeError: actualMessage
      };
      replacePlace(failedPlace);
      Utils.setLoading(false);
      return originalShowPlaceDetail(failedPlace);
    }
  };

  // window.app에도 새 동작을 연결해 노출된 API를 통한 선택도 실패 후 재시도하도록 합니다.
  if (window.app) window.app.showPlaceDetail = window.showPlaceDetail;

  // 상세 경로 요청의 실패도 실제 메시지와 error 상태로 목록에 저장합니다.
  if (typeof originalShowRouteError === 'function') {
    window.showRouteError = function showRouteErrorWithActualMessage(place, error) {
      const actualMessage = error?.message || place.routeError || 'TMAP 보행 경로 요청이 실패했습니다.';
      const failedPlace = { ...place, routeStatus: 'error', routeError: actualMessage };
      replacePlace(failedPlace);
      return originalShowRouteError(failedPlace, error);
    };
  }

  function replacePlace(updated) {
    const index = appState.places.findIndex(place => place.id === updated.id);
    if (index >= 0) appState.places[index] = updated;
    else appState.places.push(updated);
    appState.places.sort((first, second) => {
      const firstRouted = first.routeStatus === 'ok';
      const secondRouted = second.routeStatus === 'ok';
      if (firstRouted !== secondRouted) return firstRouted ? -1 : 1;
      if (firstRouted) return first.routeDistanceMeters - second.routeDistanceMeters;
      return 0;
    });
    renderPlaces();
    renderMarkers();
  }
})();
