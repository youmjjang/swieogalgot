// 모든 주변 후보는 남기되, TMAP 경로 요청 횟수는 Data 모듈의 가까운 후보 제한을 유지합니다.
(() => {
  const originalAddWalkingRoutes = window.Data?.addWalkingRoutes;
  if (!originalAddWalkingRoutes) return;

  window.Data.addWalkingRoutes = async function addWalkingRoutesPreservingCandidates(places, origin, options = {}) {
    const routed = await originalAddWalkingRoutes(places, origin, options);
    const routedIds = new Set(routed.map(place => place.id));
    const routedById = new Map(routed.map(place => [place.id, place]));
    const preserved = places.map(place => routedById.get(place.id) || {
      ...place,
      routeStatus: 'not-calculated',
      routeError: null
    });
    // 기존 함수의 거리순 정렬을 후보 집합 안에서 유지하고, 그 밖의 후보를 뒤에 보존합니다.
    const sorted = routed.map(place => preserved.find(candidate => candidate.id === place.id));
    return [...sorted, ...preserved.filter(place => !routedIds.has(place.id))];
  };
})();
