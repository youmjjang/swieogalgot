// GPS 실시간 위치와 TMAP 도보 경로를 비교해 한 단계 안내와 목적지 잔여 거리를 표시합니다.
(() => {
  function distanceMeters(first, second) {
    const radians = value => value * Math.PI / 180;
    const lat1 = radians(first[0]), lat2 = radians(second[0]);
    const deltaLat = lat2 - lat1, deltaLng = radians(second[1] - first[1]);
    const h = Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
    return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }

  function koreanizeInstruction(text) {
    return String(text || '')
      .replace(/Turn left/gi, '왼쪽으로 이동')
      .replace(/Turn right/gi, '오른쪽으로 이동')
      .replace(/Turn slightly left/gi, '왼쪽으로 약간 이동')
      .replace(/Turn slightly right/gi, '오른쪽으로 약간 이동')
      .replace(/Continue/gi, '계속 이동')
      .replace(/Walk/gi, '도보 이동')
      .replace(/Arrive at destination/gi, '목적지에 도착했습니다');
  }

  function update(state, elements, current, routePosition, Data) {
    const route = state.routeInfo;
    if (!route?.coordinates?.length) return;
    const cumulative = route.cumulativeMeters || [];
    const geometryLength = cumulative.at(-1) || route.distanceMeters;
    const progress = Math.min(geometryLength, Math.max(0, state.routeProgressMeters || 0));
    const end = route.coordinates.at(-1);
    const distanceToEnd = distanceMeters([current.lat, current.lng], end);
    const remaining = Math.max(distanceToEnd, route.distanceMeters * (1 - (geometryLength ? progress / geometryLength : 0)), 0);
    const remainingTime = route.distanceMeters > 0 ? route.durationSeconds * Math.min(1, remaining / route.distanceMeters) : 0;
    elements.navRemaining.textContent = `목적지까지 ${Data.formatRouteDistance(remaining)} · 약 ${Data.formatRouteDuration(remainingTime)}`;

    const inaccurate = Number.isFinite(current.accuracy) && current.accuracy > 80;
    if (inaccurate) {
      elements.navInstruction.textContent = '현재 위치를 확인하고 있어요';
      elements.navDistance.textContent = '위치가 안정되면 안내가 갱신됩니다';
      elements.navStatus.textContent = '기기 보고 위치 오차 약 ±' + window.formatLocationAccuracy(current.accuracy);
      return;
    }
    if (distanceToEnd <= 30) {
      elements.navInstruction.textContent = '목적지에 도착했습니다';
      elements.navDistance.textContent = state.selectedPlace?.name || '';
      elements.navRemaining.textContent = '목적지에 도착했습니다';
      elements.navStatus.textContent = '안내 종료를 누르면 상세 정보로 돌아갑니다.';
      return;
    }

    const nearestIndex = Number.isFinite(routePosition?.nearestIndex) ? routePosition.nearestIndex : 0;
    const maneuverSteps = (route.steps || []).filter(step => step.isManeuver);
    const nextStep = maneuverSteps.length
      ? maneuverSteps.find(step => step.instructionMeters >= progress - 8)
      : (route.steps || []).find(step => step.endIndex > nearestIndex && step.endIndex > 0);
    if (!nextStep) {
      elements.navInstruction.textContent = '경로를 따라 목적지 방향으로 이동하세요';
      elements.navDistance.textContent = '';
    } else {
      const stepIndex = Math.min(nextStep.endIndex, cumulative.length - 1);
      const stepDistance = Math.max(0, (nextStep.isManeuver ? nextStep.instructionMeters : (cumulative[stepIndex] ?? progress)) - progress);
      elements.navInstruction.textContent = stepDistance > 8
        ? `${Data.formatRouteDistance(stepDistance)} 후 ${koreanizeInstruction(nextStep.instruction)}`
        : koreanizeInstruction(nextStep.instruction);
      elements.navDistance.textContent = stepDistance > 8 ? '다음 안내' : '지금 방향을 바꾸세요';
    }
    if (!inaccurate && routePosition?.distanceMeters > 50) {
      elements.navInstruction.textContent = '경로에서 벗어났습니다';
      elements.navDistance.textContent = '경로 다시 찾기를 눌러 주세요';
    }
    elements.navStatus.textContent = inaccurate
      ? `GPS 위치 오차가 클 수 있습니다 (기기 보고 약 ±${window.formatLocationAccuracy(current.accuracy)}).`
      : '현재 위치를 따라 안내 중.';
  }

  window.NavigationGuidance = { update, koreanizeInstruction };
})();
