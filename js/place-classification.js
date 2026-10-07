// OSM 태그를 '착석 시설 확인'과 '휴식 가능 장소'로 분류합니다.
(() => {
  const originalConvert = window.Data?.osmElementToPlace;
  if (!originalConvert) return;

  const noFeeValues = new Set(['no', 'false', '0']);

  function isExplicitlyUnavailable(tags) {
    const access = String(tags.access || '').toLowerCase();
    const fee = String(tags.fee || '').toLowerCase();
    const charge = String(tags.charge || '').toLowerCase();
    return ['private', 'no', 'customers'].includes(access) ||
      (fee && !noFeeValues.has(fee)) || (charge && !noFeeValues.has(charge));
  }

  function isPark(tags) {
    return tags.leisure === 'park' || tags.landuse === 'recreation_ground';
  }

  function parkPlace(element, tags) {
    const lat = Number(element.lat ?? element.center?.lat);
    const lng = Number(element.lon ?? element.center?.lon);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) return null;
    if (isExplicitlyUnavailable(tags)) return null;

    return {
      id: `osm-${element.type}-${element.id}`,
      name: tags.name || '이름 없는 공원',
      type: '공원 · 착석시설 정보 확인 필요',
      category: 'park',
      resultGroup: 'possible',
      seatingStatus: 'unknown',
      lat,
      lng,
      tags,
      details: {
        locationNote: '공원 영역의 중심 좌표이며 개별 벤치·의자 위치는 확인되지 않습니다.',
        seating: '공원 후보이며 착석시설 정보는 확인되지 않음',
        ...(tags.indoor === 'yes' ? { indoor: '실내' } : {}),
        ...(tags.indoor === 'no' ? { indoor: '실외' } : {}),
        ...(tags.wheelchair === 'yes' ? { wheelchair: '휠체어 접근 표시 있음' } : {})
      },
      source: 'OpenStreetMap',
      sources: ['OpenStreetMap']
    };
  }

  function hasExplicitSeat(tags) {
    const seats = Number.parseInt(tags.seats, 10);
    return tags.amenity === 'bench' ||
      tags.leisure === 'gazebo' ||
      tags.leisure === 'picnic_table' ||
      tags.amenity === 'picnic_table' ||
      (tags.amenity === 'shelter' && (
        tags.bench === 'yes' || tags.picnic_table === 'yes' ||
        (Number.isFinite(seats) && seats > 0) || tags.shelter_type === 'picnic_shelter'
      )) ||
      tags.shelter_type === 'picnic_shelter' ||
      (tags.highway === 'bus_stop' && tags.bench === 'yes') ||
      (tags.public_transport === 'platform' && tags.bench === 'yes') ||
      tags.bench === 'yes' || tags.picnic_table === 'yes' ||
      (Number.isFinite(seats) && seats > 0);
  }

  window.Data.osmElementToPlace = function osmElementToPlaceWithGroups(element) {
    const tags = element?.tags || {};
    // 공원 영역의 bench=yes는 개별 벤치 좌표가 아니므로 공원 후보로 남깁니다.
    if (isPark(tags)) return parkPlace(element, tags);

    const place = originalConvert(element);
    if (!place) return null;

    const seatingConfirmed = hasExplicitSeat(tags);
    if (!seatingConfirmed && (tags.amenity === 'shelter' || tags.tourism === 'picnic_site')) {
      place.type = tags.amenity === 'shelter'
        ? '쉼터 · 착석시설 정보 확인 필요'
        : '피크닉 장소 · 착석시설 정보 확인 필요';
      place.details = {
        ...place.details,
        seating: '휴식 장소 후보이며 좌석 정보는 확인되지 않음'
      };
    }
    place.resultGroup = seatingConfirmed ? 'confirmed' : 'possible';
    place.seatingStatus = seatingConfirmed ? 'confirmed' : 'unknown';
    place.sources = ['OpenStreetMap'];
    return place;
  };
})();
