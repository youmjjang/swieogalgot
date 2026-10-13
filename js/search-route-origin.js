// 호출자가 선택한 출발점을 그대로 사용합니다. 앱이 검색/GPS 출발점과 요청 토큰을 관리합니다.
(() => {
  window.SearchRouteOrigin = {
    resolve(state) {
      const origin = state.searchOrigin || state.userLocation;
      return origin && Number.isFinite(origin.lat) && Number.isFinite(origin.lng)
        ? { lat: origin.lat, lng: origin.lng, name: origin.name || state.searchLabel || '선택한 위치' }
        : null;
    }
  };
})();
