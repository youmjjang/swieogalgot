# 쉬엄쉬엄 — 주변 휴식공간 찾기

현재 위치나 검색한 장소를 기준으로 주변의 벤치·정자·공원 등 휴식공간 후보를 지도와 목록으로 찾아보는 반응형 웹 앱입니다. 목록은 거리 기준으로 정렬하며, 장소를 선택하면 상세 정보와 TMAP 보행 경로를 확인할 수 있습니다.

> 지도 데이터에 장소가 등록되어 있다는 사실만으로 좌석의 실제 상태, 무료 이용, 개방 여부 또는 현재 이용 가능 여부가 확인되는 것은 아닙니다. 방문 전에 현장에서 확인해 주세요.

## 주요 기능

- **위치 지정:** 브라우저의 현재 위치를 사용하거나 주소·장소명을 검색합니다. 검색 입력에 두 글자 이상 입력하면 추천 장소를 불러오며, 검색 결과를 선택해 주변 장소를 찾을 수 있습니다.
- **주변 장소 검색:** OpenStreetMap(Overpass)의 벤치·착석시설과 공원·쉼터 후보를 조회하고, TMAP 장소 검색에서 주변 공원 후보를 추가로 가져옵니다. 데이터가 모자라면 목록의 **더 넓게 검색**으로 반경을 1km에서 1.5km, 2km까지 넓힐 수 있습니다.
- **지도와 목록:** 검색한 휴식공간을 지도 마커와 목록에 표시합니다. 휴식공간 마커는 착석 여부와 관계없이 초록색 핀으로 통일되어 있으며, 마커를 누르면 목록에서 장소를 선택했을 때와 같은 상세 화면이 열립니다. 현재 위치는 파란색 표시로 구분합니다.
- **가까운 장소 선택 및 보행 경로:** 가까운 후보 최대 12곳의 TMAP 보행 경로를 먼저 조회합니다. 장소를 선택하면 해당 장소의 경로를 요청하고 지도에 표시합니다. 경로를 계산하지 않은 나머지 후보도 목록과 지도에 남으며, 선택 시 개별 경로를 요청합니다. 경로 요청이 실패하면 직선거리로 대체하지 않고 실패 상태를 안내합니다.
- **GPS 실시간 안내:** 상세 화면에서 현재 위치를 기준으로 실시간 안내를 시작할 수 있습니다. 기기의 GPS 위치와 경로를 비교해 안내를 갱신합니다. 상용 내비게이션이 아니며 음성 안내나 앱이 백그라운드에 있을 때의 추적은 제공하지 않습니다.

## 실행 방법

필요한 환경은 Node.js 18 이상입니다. 프로젝트 루트에서 의존성을 설치합니다.

```sh
npm install
```

TMAP API 기능을 사용하려면 프로젝트 루트에 `.env` 파일을 만들고 발급받은 앱 키를 설정합니다.

```dotenv
TMAP_APP_KEY=발급받은_App_Key
```

키는 서버의 환경변수로만 사용되며 브라우저 코드에는 넣지 않습니다. `.env`는 Git 저장소나 제출·배포 ZIP에 포함하지 마세요. 배포 환경에서는 Node.js 서버 호스팅의 비밀 환경변수에 `TMAP_APP_KEY`를 등록합니다.

서버를 실행합니다.

```sh
npm start
```

또는 `node server.js`를 실행해도 됩니다. 브라우저에서 다음 주소를 엽니다.

```text
http://127.0.0.1:3000
```

서버는 정적 웹 파일을 제공하고 `/api/overpass`에서 OpenStreetMap Overpass 요청을 중계하며, `/api/tmap/search`, `/api/tmap/parks`, `/api/tmap/pedestrian` 요청을 TMAP에 전달합니다. Overpass 쿼리는 브라우저가 외부 서버로 직접 보내지 않고 앱 서버를 통해 전달하므로 브라우저의 Overpass CORS 제한 영향을 피합니다. 서버는 제한된 Overpass 서버 허용 목록을 차례로 시도하고, 성공 응답을 짧게 캐시하며 중복 요청을 합칩니다. 이는 외부 서버의 시간 초과나 장애 자체를 없애지는 않습니다.

TMAP 키를 설정하지 않으면 TMAP 장소 검색과 보행 경로 기능은 사용할 수 없습니다. 주변 Overpass 검색은 TMAP 키 없이도 가능하지만 서버와 외부 Overpass 서비스에 연결되어야 합니다.

현재 위치 기능은 브라우저의 위치 권한이 필요하며, 일반적으로 HTTPS 또는 `localhost`와 같은 안전한 출처에서만 사용할 수 있습니다.

## 데이터와 처리 방식

### OpenStreetMap / Overpass

- 착석시설과 공원·녹지 후보를 별도 조회합니다. 예를 들어 `amenity=bench`, `bench=yes`, 정자·쉼터 태그와 `leisure=park`, `landuse=recreation_ground` 등을 사용합니다.
- 태그에 착석시설 정보가 명시된 후보와 착석 여부를 확인해야 하는 후보를 구분해 목록에 설명을 표시합니다. 이 구분은 목록 정보용이며 현재 지도 마커 모양에는 차이를 주지 않습니다.
- 태그에 유료 이용 정보가 명시되어 있거나 사적·제한 접근으로 표시된 후보는 검색에서 제외합니다. 비용이나 접근 태그가 없다는 것은 무료·개방이 확인되었다는 뜻이 아닙니다.
- 공원 영역의 중심 좌표는 개별 벤치나 입구의 위치가 아닐 수 있습니다. 일부 장소 데이터가 빠져 있거나 오래되었을 수도 있습니다.
- 브라우저는 `/api/overpass`에 검색 유형, 좌표와 반경만 보내며, 서버가 쿼리를 생성해 허용된 Overpass endpoint에 요청합니다. 각 쿼리는 endpoint별 최대 6초 제한과 대체 endpoint 순차 재시도를 사용합니다. 모든 외부 endpoint가 실패하면 서버는 검색 실패를 앱에 전달합니다.

### TMAP Mobility

- 서버는 장소 검색, 주변 공원 검색, 보행 경로 요청을 TMAP API에 전달합니다. 브라우저가 TMAP 앱 키를 직접 보관하지 않도록 앱 키는 서버에서 읽습니다.
- 지도상의 보행 경로 거리와 예상 시간은 TMAP 응답을 바탕으로 표시합니다. 실제 통행 가능 여부나 현장 상황을 보장하지 않습니다.

### 공공데이터 확장 지점

`js/public-data.js`에는 국내 공공데이터 provider를 등록할 수 있는 어댑터 구조가 있습니다. provider는 데이터를 앱의 표준 장소 객체로 변환하고, 좌표는 WGS84 위도·경도로 맞춰야 합니다. 현재 프로젝트에는 어댑터 구조만 있으며, 별도의 국내 공공데이터 provider는 등록되어 있지 않습니다.

provider 등록 예시:

```js
Data.registerPublicPlaceProvider({
  id: 'provider-id',
  source: '제공기관·데이터셋 이름',
  async fetch({ lat, lng, radiusMeters, coordinateSystem }) {
    // 원본 데이터 조회 후 레코드 배열 반환
    return [];
  },
  normalize(record) {
    // 원본 좌표계를 WGS84로 변환해 표준 장소 객체 반환
    return {
      id: 'record-id',
      name: '장소명',
      type: '공원',
      category: 'park',
      lat: 37.0,
      lng: 127.0,
      resultGroup: 'possible',
      details: { seating: '착석시설 정보 확인 필요' }
    };
  }
});
```

provider를 추가하기 전에는 데이터 출처, 좌표계, 사용 약관, 출처 표시 의무와 CORS를 확인해야 합니다. provider의 `normalize()`는 원본 좌표계를 WGS84로 변환해야 합니다.

## 주요 파일

- `index.html` — 화면 구조, 외부 라이브러리와 앱 파일 연결
- `css/style.css` — 화면 및 반응형 레이아웃 스타일
- `css/park-map-markers.css` — 통일된 휴식공간 마커 스타일
- `js/app.js` — 화면 상태, 위치 검색, 지도, 상세 화면과 GPS 안내
- `js/data.js` — 장소 검색 응답 및 TMAP 보행 경로 데이터 처리
- `js/overpass.js` — 앱 서버를 통한 OpenStreetMap Overpass 주변 장소 조회
- `js/public-data.js` — TMAP 공원 결과 결합 및 공공데이터 provider 확장 지점
- `js/place-classification.js` — 착석시설 정보에 따른 장소 분류
- `js/park-map-markers.js`, `js/park-results-ui.js` — 지도 마커와 결과 목록 표시
- `server.js` — 정적 파일 서버 및 TMAP/Overpass API 중계
- `package.json` — 실행 명령과 의존성

## 확인이 필요한 점

- OpenStreetMap 및 TMAP 데이터의 범위와 정확도는 지역마다 다를 수 있습니다. 검색 결과가 없더라도 실제 휴식공간이 없다는 뜻은 아닙니다.
- TMAP 키, 외부 지도 타일, OpenStreetMap/Overpass 및 TMAP 서비스 연결 상태에 따라 기능이 달라질 수 있습니다.
- `package.json`에는 자동 테스트 명령이 정의되어 있지 않습니다. 브라우저에서 위치 권한, 장소 검색, 마커 선택, 상세 화면과 실제 길찾기를 확인하려면 위 방법으로 앱을 실행해 주세요.

## 출처

- 지도 및 OSM 데이터: [OpenStreetMap 저작권 및 기여자](https://www.openstreetmap.org/copyright)
- 보행 경로·장소 검색: [TMAP Mobility](https://tmapmobility.com/)
- Overpass API: [Overpass API](https://wiki.openstreetmap.org/wiki/Overpass_API)
- Leaflet: [Leaflet](https://leafletjs.com/)

## Overpass 장애 시 대체 조회

서버에서 OSM Map API를 제한된 검색 영역으로 우선 조회해 점 형태의 벤치·정자·쉼터를 가져옵니다. 실패하면 서버 Overpass 조회, 브라우저 직접 조회 순으로 전환합니다. 면 형태의 공원은 TMAP 결과를 함께 사용합니다. 같은 영역의 동시 요청은 하나로 합치고, 추린 결과는 1시간 캐시합니다. 데이터가 많은 영역은 노드 제한 응답이 있을 때만 최대 3단계로 나누며 전체 대체 조회 시간은 20초, 개별 응답 크기는 64MB로 제한합니다. 공개 서비스 규모로 확장할 때는 지역 추출 데이터나 전용 데이터 서버로 전환해야 합니다.
