// Overpass 검색 중에는 그룹화한 장소 후보를 표시하며, 클릭 시 기존 상세/TMAP 흐름을 호출합니다.
(() => {
  const list=document.getElementById('placesList'), emptyState=document.getElementById('emptyState'), resultsCount=document.getElementById('resultsCount');
  const tabCount=document.getElementById('tabCount'), locationHint=document.getElementById('locationHint'), loadingOverlay=document.getElementById('loadingOverlay');
  const originalSetLoading=window.Utils?.setLoading; let hasPartialResults=false;
  if(originalSetLoading) window.Utils.setLoading=(show,text='')=>{if(show&&hasPartialResults){originalSetLoading(false);return;}originalSetLoading(show,text);};
  function clearPreview(){hasPartialResults=false;list?.replaceChildren();if(resultsCount)resultsCount.textContent='휴식공간 검색 중';if(tabCount)tabCount.textContent='';if(emptyState)emptyState.hidden=true;if(loadingOverlay)loadingOverlay.hidden=false;}
  function renderPreview(detail) {
    const places=Array.isArray(detail.places)?detail.places:[];if(!places.length||!list)return;hasPartialResults=true;list.replaceChildren();
    if(resultsCount)resultsCount.textContent=`휴식공간 ${places.length}곳`;if(tabCount)tabCount.textContent=`(${places.length})`;if(emptyState)emptyState.hidden=true;
    if(locationHint)locationHint.textContent=`반경 ${(detail.radiusMeters/1000).toFixed(1)}km에서 장소 ${places.length}곳을 찾았습니다 · 장소 선택 시 TMAP 도보 경로를 계산합니다.`;
    if(loadingOverlay)loadingOverlay.hidden=true;
    for(const group of [
      {id:'confirmed',title:'확실한 착석 공간',places:places.filter(place=>place.resultGroup!=='possible')},
      {id:'possible',title:'휴식 가능 장소 · 착석시설 정보 확인 필요',places:places.filter(place=>place.resultGroup==='possible')}
    ]) {
      if(!group.places.length)continue;const heading=document.createElement('h3');heading.className=`place-group-title place-group-${group.id}`;heading.textContent=`${group.title} (${group.places.length})`;list.append(heading);
      for(const place of group.places) {
        const card=document.createElement('button');card.type='button';card.className='place-card';card.setAttribute('role','listitem');
        const icon=place.category==='bench'?'▰':place.category==='transit'?'↔':place.category==='picnic'?'⌑':place.category==='park'?'♧':'⌂';
        const top=document.createElement('span');top.className='place-card-top';const iconNode=document.createElement('span');iconNode.className='place-kind-icon';iconNode.setAttribute('aria-hidden','true');iconNode.textContent=icon;
        const headingNode=document.createElement('span');headingNode.className='place-heading';const name=document.createElement('span');name.className='place-name';name.textContent=place.name;
        const type=document.createElement('span');type.className='place-type';type.textContent=place.type;headingNode.append(name,type);top.append(iconNode,headingNode);
        const details=document.createElement('span');details.className='place-details';const status=document.createElement('span');status.textContent='TMAP 도보 경로는 장소 선택 시 계산';details.append(status);
        for(const [,text] of Object.entries(place.details||{}).filter(([key])=>key!=='name').slice(0,2)){const badge=document.createElement('span');badge.textContent=text;details.append(badge);}
        card.append(top,details);card.addEventListener('click',()=>window.showPlaceDetail(place));list.append(card);
      }
    }
    if(window.matchMedia('(max-width: 859px)').matches)document.getElementById('tabList')?.click();
  }
  window.addEventListener('overpass:search-start',clearPreview);
  window.addEventListener('overpass:results',event=>renderPreview(event.detail||{}));
  window.addEventListener('overpass:search-done',()=>{if(hasPartialResults&&locationHint)locationHint.textContent='휴식공간 후보를 표시했습니다 · 장소를 선택하면 TMAP 도보 경로를 계산합니다.';});
})();
