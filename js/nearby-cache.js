// 최근 5분, 같은 검색 반경, 40m 이내의 완료된 주변 검색을 재사용합니다.
(() => {
  const original = window.Data.fetchPlacesFromOSM;
  const cache = [];
  const pending = [];
  const clone = value => structuredClone(value);
  function distance(a, b) {
    const rad = Math.PI / 180;
    const x = (a.lng - b.lng) * rad * Math.cos((a.lat + b.lat) * rad / 2);
    const y = (a.lat - b.lat) * rad;
    return 6371000 * Math.hypot(x, y);
  }
  const matches = (entry, lat, lng, radius) => entry.radius === radius && distance(entry, { lat, lng }) <= 40;
  window.Data.fetchPlacesFromOSM = async (lat, lng, options = {}) => {
    const radius = options.radiusMeters || 1000;
    const now = Date.now();
    for (let i = pending.length - 1; i >= 0; i--) if (now - pending[i].started >= 30000) pending.splice(i, 1);
    const hit = cache.find(entry => entry.expires > now && matches(entry, lat, lng, radius));
    if (hit) return clone(hit.result);
    const active = pending.find(entry => now - entry.started < 30000 && matches(entry, lat, lng, radius));
    if (active) {
      if (options.onUpdate) active.listeners.push(options.onUpdate);
      return clone(await active.promise);
    }
    const entry = { lat, lng, radius, started: now, listeners: options.onUpdate ? [options.onUpdate] : [] };
    const finish = () => { const index = pending.indexOf(entry); if (index >= 0) pending.splice(index, 1); };
    function remember(result) {
      if (!result.isDone || result.allFailed || result.hasPartialFailure) return;
      cache.unshift({ lat, lng, radius, expires: Date.now() + 300000, result: clone(result) });
      cache.splice(8);
    }
    pending.push(entry);
    entry.promise = Promise.resolve().then(() => original(lat, lng, {
      ...options,
      onUpdate(update) {
        remember(update);
        for (const listener of entry.listeners) listener(clone(update));
        if (update.isDone) finish();
      }
    })).then(result => {
      remember(result);
      if (result.isDone) finish();
      return result;
    }).catch(error => { finish(); throw error; });
    return clone(await entry.promise);
  };
})();
