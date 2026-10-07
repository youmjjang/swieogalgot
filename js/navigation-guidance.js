// TMAP 경로의 끝에 가까운 세그먼트에 있다는 이유만으로 도착 처리하지 않도록 안내를 보정합니다.
(() => {
  function distanceMeters(first, second) {
    const toRadians = value => value * Math.PI / 180;
    const lat1 = toRadians(first[0]);
    const lat2 = toRadians(second[0]);
    const deltaLat = lat2 - lat1;
    const deltaLng = toRadians(second[1] - first[1]);
    const haversine = Math.sin(deltaLat / 2) ** 2
      + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
    return 6371000 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
  }

  window.updateNavigationGuidance = function updateNavigationGuidanceWithArrivalCheck(current, routePosition) {
    const route = appState.routeInfo;
    if (!route || !route.coordinates?.length) return;

    const cumulative = route.cumulativeMeters || [];
    const geometryLength = cumulative[cumulative.length - 1] || route.distanceMeters;
    const progress = Math.min(geometryLength, Math.max(0, appState.routeProgressMeters));
    const progressRatio = geometryLength > 0 ? Math.min(1, progress / geometryLength) : 0;
    const routeEnd = route.coordinates[route.coordinates.length - 1];
    const distanceToRouteEnd = distanceMeters([current.lat, current.lng], routeEnd);
    const remainingDistance = Math.max(
      0,
      route.distanceMeters * (1 - progressRatio),
      distanceToRouteEnd
    );
    const remainingDuration = route.distanceMeters > 0
      ? route.durationSeconds * Math.min(1, remainingDistance / route.distanceMeters)
      : route.durationSeconds;

    elements.navRemaining.textContent = `목적지까지 ${Data.formatRouteDistance(remainingDistance)} · 약 ${Data.formatRouteDuration(remainingDuration)}`;

    // 마지막 선분에 가장 가까운 것만으로 도착을 판정하면 짧은 경로에서 즉시 완료될 수 있습니다.
    // TMAP 경로 끝점에 실제로 근접했을 때만 도착으로 처리합니다.
    if (distanceToRouteEnd <= 30) {
      elements.navInstruction.textContent = '목적지에 도착했습니다';
      elements.navDistance.textContent = appState.selectedPlace?.name || '';
      elements.navRemaining.textContent = '목적지에 도착했습니다';
      elements.navStatus.textContent = '안내 종료를 누르면 장소 상세로 돌아갑니다.';
      elements.btnRecalculateRoute.hidden = true;
      return;
    }

    const nearestIndex = Number.isFinite(routePosition?.nearestIndex) ? routePosition.nearestIndex : 0;
    const nextStep = route.steps.find(step => step.endIndex > nearestIndex && step.endIndex > 0);
    if (!nextStep) {
      elements.navInstruction.textContent = '경로를 따라 목적지 방향으로 이동하세요';
      elements.navDistance.textContent = '';
    } else {
      const stepEndIndex = Math.min(nextStep.endIndex, cumulative.length - 1);
      const distanceToStep = Math.max(0, (cumulative[stepEndIndex] ?? progress) - progress);
      const instruction = koreanizeInstruction(nextStep.instruction);
      elements.navInstruction.textContent = distanceToStep > 8
        ? `${Data.formatRouteDistance(distanceToStep)} 후 ${instruction}`
        : instruction;
      elements.navDistance.textContent = distanceToStep > 8 ? '다음 안내' : '지금 방향을 바꾸세요';
    }

    elements.navStatus.textContent = Number.isFinite(current.accuracy) && current.accuracy > 80
      ? `GPS 위치 오차가 클 수 있습니다 (기기 보고 약 ±${formatLocationAccuracy(current.accuracy)}).`
      : '현재 위치를 따라 안내 중.';
    elements.btnRecalculateRoute.hidden = true;
  };
})();
