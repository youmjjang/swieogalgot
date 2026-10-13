// TMAP 경로가 계산된 후보와 계산되지 않은 나머지 후보를 하나의 목록으로 보존합니다.
(() => {
  function preserve(originalPlaces, routedPlaces) {
    const byId = new Map((routedPlaces || []).map(place => [place.id, place]));
    return (originalPlaces || []).map(place => byId.get(place.id) || {
      ...place, routeStatus: 'not-calculated', routeError: null
    });
  }
  window.RouteCandidatePreservation = { preserve };
})();
