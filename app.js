'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const LOCAL_KEY = 'travel-atlas-draft-v1';
  const REPO = 'Warren-xh/travel-atlas';
  const CONTENT_URL = 'https://api.github.com/repos/' + REPO + '/contents/data/atlas.json';
  const CONTINENTS = [ ['world','世界','WORLD'],['Europe','欧洲','EUROPE'],['Asia','亚洲','ASIA'],['Africa','非洲','AFRICA'],['North America','北美洲','NORTH AMERICA'],['South America','南美洲','SOUTH AMERICA'],['Oceania','大洋洲','OCEANIA'],['Antarctica','南极洲','ANTARCTICA'] ];
  const views = {Europe:[17,52,.82],Asia:[100,35,.57],Africa:[20,1,.67],'North America':[-100,42,.54],'South America':[-63,-23,.67],Oceania:[153,-22,.57]};
  let metadata=[],geometry,documentData,baseline,selected='IRL',continent='Europe',admin=false,projection,path,zoom,root,mapWidth,mapHeight,searchTimer,toastTimer;
  const copy = value => JSON.parse(JSON.stringify(value));
  const info = id => metadata.find(c => c.id === id);
  const record = id => documentData.countries[id] || {status:'none',note:'',date:''};
  const statusInfo = id => documentData.palette.find(c => c.id === record(id).status);
  const fill = id => statusInfo(id)?.color || 'transparent';
  const belongs = country => continent === 'world' || country.continents.includes(continent);
  function toast(message) { $('toast').textContent=message; $('toast').hidden=false; clearTimeout(toastTimer); toastTimer=setTimeout(()=>{$('toast').hidden=true;},4200); }
  function setSaveStatus(message) { $('save-status').textContent=message; }
  function validate(value) {
    if (!value || value.version!==1 || !Array.isArray(value.palette) || value.palette.length!==5 || !value.countries || typeof value.countries!=='object' || Array.isArray(value.countries)) throw Error('这不是有效的地图备份文件。');
    const allowed = ['free','visited','evisa','orange','purple'];
    if (new Set(value.palette.map(p=>p.id)).size!==5 || value.palette.some(p=>!allowed.includes(p.id)||!/^#[\da-f]{6}$/i.test(p.color)||typeof p.label!=='string'||p.label.length>30)) throw Error('颜色设置格式不正确。');
    const validIds=new Set(metadata.map(c=>c.id));
    for(const [id,r] of Object.entries(value.countries)) {
      if(!validIds.has(id)||!r||typeof r!=='object'||!['none',...allowed].includes(r.status)||typeof r.note!=='string'||r.note.length>5000||typeof r.date!=='string'||(r.date&&!/^\d{4}-\d{2}-\d{2}$/.test(r.date))) throw Error('国家记录格式不正确：'+id);
      if(r.source && (typeof r.source!=='string'||!/^https:\/\//.test(r.source))) throw Error('来源链接必须使用 HTTPS。');
    }
    return copy(value);
  }
  function persist(message='已保存到当前浏览器') {
    try { localStorage.setItem(LOCAL_KEY,JSON.stringify({data:documentData,baseline})); setSaveStatus('有本机记录'); toast(message); }
    catch {setSaveStatus('保存失败');toast('浏览器无法保存记录，请先导出备份。');}
  }
  function setMode(next) {
    admin=next; $('map-mode').classList.toggle('active',!admin);$('admin-mode').classList.toggle('active',admin);
    $('panel-heading').textContent=admin?'MANAGE YOUR MAP':'COUNTRY NOTES'; $('view-fields').hidden=admin;$('editor').hidden=!admin;
    history.replaceState(null,'',admin?'#admin':'#map'); renderCountry();
  }
  function renderColors() {
    const entries=[...documentData.palette,{id:'none',label:'透明 / 其他',color:'transparent'}];
    $('legend').replaceChildren(...entries.map(c=>{const item=document.createElement('span');item.className='legend-item';const swatch=document.createElement('i');swatch.className='swatch'+(c.id==='none'?' transparent':'');swatch.style.backgroundColor=c.color;item.append(swatch,document.createTextNode(c.label));return item;}));
    $('color-options').replaceChildren(...entries.map(c=>{const label=document.createElement('label');label.className='color-option';const input=document.createElement('input');input.type='radio';input.name='status';input.value=c.id;input.checked=record(selected).status===c.id;const dot=document.createElement('i');dot.className='swatch'+(c.id==='none'?' transparent':'');dot.style.backgroundColor=c.color;const text=document.createElement('span');text.textContent=c.label;label.append(input,dot,text);return label;}));
  }
  function renderCountry() {
    const country=info(selected);if(!country)return;const r=record(selected);const s=statusInfo(selected);
    $('country-name').textContent=country.name;$('country-english').textContent=country.english;$('country-flag').textContent=country.flag||'◎';
    $('country-status').replaceChildren();const dot=document.createElement('i');dot.className='swatch'+(!s?' transparent':'');dot.style.backgroundColor=s?.color||'transparent';$('country-status').append(dot,document.createTextNode(s?.label||'透明 / 其他'));
    $('view-date').textContent=r.date||'还没有记录';$('view-note').textContent=r.note||'旅行见闻、路线、想去的城市……\n都可以留在这里。';$('view-note').classList.toggle('empty-note',!r.note);
    $('travel-date').value=r.date||'';$('country-note').value=r.note||'';
    $('visa-source').hidden=!r.source;if(r.source){$('source-link').href=r.source;$('source-date').textContent='核实日期：'+(r.checkedAt||'未记录')+' · 此来源对应初始签证分类';}
    renderColors();recolor();renderStats();
  }
  function renderStats() {
    const all=Object.values(documentData.countries);$('visited-count').textContent=all.filter(r=>r.status==='visited').length;$('free-count').textContent=all.filter(r=>r.status==='free').length;$('notes-count').textContent=all.filter(r=>r.note?.trim()).length;
  }
  function recolor() {
    if(!root)return;root.selectAll('.country').attr('fill',f=>belongs(info(f.properties.id))?fill(f.properties.id):'transparent').classed('selected',f=>f.properties.id===selected).attr('aria-label',f=>info(f.properties.id).name+'，'+(statusInfo(f.properties.id)?.label||'其他'));
    root.selectAll('.micro-country').attr('fill',f=>fill(f.id)).classed('selected',f=>f.id===selected);root.selectAll('.country-label').classed('selected',f=>f.id===selected);
  }
  function selectCountry(id) {
    if(!info(id))return;selected=id;$('country-search').value='';$('search-results').hidden=true;$('clear-search').hidden=true;
    if(!belongs(info(id))) setContinent(info(id).continents[0]);else renderCountry();
    if(innerWidth<=760 && admin)$('country-name').scrollIntoView({behavior:'smooth',block:'center'});
  }
  function setContinent(id) {
    continent=id; $('continents').querySelectorAll('button').forEach(b=>{const active=b.dataset.continent===id;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});
    const entry=CONTINENTS.find(c=>c[0]===id);$('region-title').textContent=entry[1];$('region-english').textContent=entry[2];$('region-count').textContent=metadata.filter(belongs).length+' 个国家 / 地区';
    if(!belongs(info(selected))){selected=metadata.filter(belongs).find(c=>record(c.id).status!=='none')?.id||metadata.find(belongs)?.id||'ATA';}
    drawMap();renderCountry();
  }
  function tooltip(event,country) {
    const t=$('tooltip');t.replaceChildren(document.createTextNode(country.name));const small=document.createElement('small');small.textContent=statusInfo(country.id)?.label||'透明 / 其他';t.append(small);t.hidden=false;
    const bounds=$('map-stage').getBoundingClientRect();t.style.left=Math.min(event.clientX-bounds.left+12,bounds.width-t.offsetWidth-8)+'px';t.style.top=Math.max(8,event.clientY-bounds.top-t.offsetHeight-12)+'px';
  }
  function drawMap() {
    if(!geometry)return;const stage=$('map-stage');mapWidth=stage.clientWidth;mapHeight=stage.clientHeight;const svg=d3.select('#map');svg.selectAll('*').remove();svg.attr('viewBox','0 0 '+mapWidth+' '+mapHeight);
    if(continent==='world')projection=d3.geoNaturalEarth1().fitExtent([[20,35],[mapWidth-20,mapHeight-70]],{type:'Sphere'});
    else if(continent==='Antarctica')projection=d3.geoOrthographic().rotate([0,90]).clipAngle(40).scale(Math.min(mapWidth,mapHeight)*.95).translate([mapWidth/2,mapHeight/2]);
    else {const v=views[continent];projection=d3.geoMercator().rotate([-v[0],0]).center([0,v[1]]).scale(Math.min(mapWidth,mapHeight)*v[2]).translate([mapWidth/2,mapHeight/2]);}
    path=d3.geoPath(projection);root=svg.append('g');root.append('path').datum(d3.geoGraticule10()).attr('class','graticule').attr('d',path);
    const available=geometry.features.filter(f=>info(f.properties.id));
    root.selectAll('.country').data(available).join('path').attr('class',f=>'country'+(!belongs(info(f.properties.id))?' context':'')).attr('data-country',f=>f.properties.id).attr('d',path).attr('tabindex',f=>belongs(info(f.properties.id))?'0':null).attr('role','button').on('click',(e,f)=>{if(belongs(info(f.properties.id)))selectCountry(f.properties.id);}).on('keydown',(e,f)=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();selectCountry(f.properties.id);}}).on('pointermove',(e,f)=>{if(belongs(info(f.properties.id)))tooltip(e,info(f.properties.id));}).on('pointerleave',()=>{$('tooltip').hidden=true;});
    const centers=metadata.filter(belongs).map(c=>{const f=available.find(f=>f.properties.id===c.id);let xy=f?path.centroid(f):projection([c.lng,c.lat]);if(!xy||!Number.isFinite(xy[0]))return null;return {...c,xy,small:!f||path.area(f)<22,area:f?path.area(f):0};}).filter(c=>c&&c.xy[0]>7&&c.xy[0]<mapWidth-7&&c.xy[1]>12&&c.xy[1]<mapHeight-55);
    root.selectAll('.micro-country').data(centers.filter(c=>c.small)).join('circle').attr('class','micro-country').attr('data-country',c=>c.id).attr('cx',c=>c.xy[0]).attr('cy',c=>c.xy[1]).attr('r',3.4).attr('tabindex','0').attr('role','button').attr('aria-label',c=>c.name).on('click',(e,c)=>selectCountry(c.id)).on('keydown',(e,c)=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();selectCountry(c.id);}}).on('pointermove',(e,c)=>tooltip(e,c)).on('pointerleave',()=>{$('tooltip').hidden=true;});
    const placed=[];const labelCandidates=centers.sort((a,b)=>(b.id===selected?1:0)-(a.id===selected?1:0)||b.area-a.area);const labels=labelCandidates.filter(c=>{if(continent==='world'&&c.area<800&&c.id!==selected)return false;const x=c.xy[0],y=c.xy[1]+(c.small?12:0),w=c.name.length*10+8;const box=[x-w/2,y-6,x+w/2,y+6];if(c.id!==selected&&placed.some(b=>!(box[2]<b[0]||box[0]>b[2]||box[3]<b[1]||box[1]>b[3])))return false;placed.push(box);return true;});
    root.selectAll('.country-label').data(labels).join('text').attr('class','country-label').attr('x',c=>c.xy[0]).attr('y',c=>c.xy[1]+(c.small?12:0)).attr('text-anchor','middle').attr('dominant-baseline','middle').text(c=>c.name).attr('display',$('show-labels').checked?null:'none');
    zoom=d3.zoom().scaleExtent([1,8]).on('zoom',e=>{root.attr('transform',e.transform);root.selectAll('.country-label').attr('font-size',10/e.transform.k).style('font-size',10/e.transform.k+'px').attr('stroke-width',2.8/e.transform.k);root.selectAll('.micro-country').attr('r',3.4/e.transform.k);$('tooltip').hidden=true;});svg.call(zoom).on('dblclick.zoom',null);recolor();
  }
  function search() {
    const query=$('country-search').value.trim().toLowerCase();$('clear-search').hidden=!query;$('search-results').hidden=!query;if(!query)return;
    const matches=metadata.filter(c=>(c.name+' '+c.english+' '+c.id).toLowerCase().includes(query)).slice(0,15);
    $('search-results').replaceChildren(...matches.map(c=>{const b=document.createElement('button');b.type='button';const dot=document.createElement('i');dot.className='swatch'+(record(c.id).status==='none'?' transparent':'');dot.style.backgroundColor=fill(c.id);const small=document.createElement('small');small.textContent=c.id;b.append(dot,document.createTextNode(c.name),small);b.onclick=()=>selectCountry(c.id);return b;}));
    if(!matches.length){const p=document.createElement('p');p.textContent='没有找到匹配的国家';$('search-results').append(p);}
  }
  function openPalette() {
    $('palette-fields').replaceChildren(...documentData.palette.map(c=>{const row=document.createElement('div');row.className='palette-row';const color=document.createElement('input');color.type='color';color.value=c.color;color.name=c.id+'-color';color.setAttribute('aria-label',c.label+'颜色');const label=document.createElement('input');label.type='text';label.value=c.label;label.maxLength=30;label.required=true;label.name=c.id+'-label';label.setAttribute('aria-label',c.label+'名称');row.append(color,label);return row;}));$('palette-dialog').showModal();
  }
  function exportBackup() {
    const blob=new Blob([JSON.stringify(documentData,null,2)],{type:'application/json'});const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download='travel-atlas-'+new Date().toISOString().slice(0,10)+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);toast('已导出颜色和记录备份');
  }
  function decodeContent(content) {const bytes=Uint8Array.from(atob(content.replace(/\s/g,'')),c=>c.charCodeAt(0));return new TextDecoder().decode(bytes);}
  function encodeContent(content) {const bytes=new TextEncoder().encode(content);let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);return btoa(binary);}
  async function githubRequest(method,body) {
    const token=$('github-token').value.trim();if(!token)throw Error('请先填写仅有本仓库 Contents 写入权限的 Token。');
    const response=await fetch(CONTENT_URL+(method==='GET'?'?ref=main':''),{method,cache:'no-store',headers:{Accept:'application/vnd.github+json',Authorization:'Bearer '+token,'X-GitHub-Api-Version':'2022-11-28',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
    if(!response.ok){const codes={401:'授权无效或已过期，请重新填写 Token。',403:'Token 没有仓库写入权限，或 GitHub 暂时限制了请求。',404:'未能访问仓库，请确认 Token 已选择 travel-atlas。',409:'GitHub 记录刚刚发生变化，请先拉取最新记录。',422:'GitHub 未接受这次保存，请检查仓库分支和授权。'};throw Error(codes[response.status]||'GitHub 请求失败（'+response.status+'）');}return response.json();
  }
  function setBusy(busy) {$('confirm-publish').disabled=busy;$('pull-remote').disabled=busy;}
  async function publish() {
    setBusy(true);$('publish-message').textContent='正在检查 GitHub 最新记录…';
    try {
      const remote=await githubRequest('GET');const remoteData=validate(JSON.parse(decodeContent(remote.content)));
      if(JSON.stringify(remoteData)!==JSON.stringify(baseline))throw Error('GitHub 上有更新。请先导出本机备份，再拉取最新记录，避免覆盖其他设备的修改。');
      const next=copy(documentData);next.updatedAt=new Date().toISOString();validate(next);
      const result=await githubRequest('PUT',{message:'Update travel map records',content:encodeContent(JSON.stringify(next,null,2)+'\n'),sha:remote.sha,branch:'main'});
      documentData=next;baseline=copy(next);localStorage.removeItem(LOCAL_KEY);setSaveStatus('已发布到 GitHub');$('publish-message').textContent='发布成功！网页稍后自动更新。提交：'+result.commit.sha.slice(0,7);toast('记录已发布到 GitHub');
    }catch(e){$('publish-message').textContent=e.message;}finally{setBusy(false);}
  }
  async function pullRemote() {
    if(!confirm('拉取会替换当前浏览器的地图记录。尚未发布的修改，请先导出备份。继续拉取？'))return;
    setBusy(true);try{const remote=await githubRequest('GET');documentData=validate(JSON.parse(decodeContent(remote.content)));baseline=copy(documentData);localStorage.removeItem(LOCAL_KEY);renderCountry();setSaveStatus('已拉取 GitHub 最新记录');$('publish-message').textContent='已更新为 GitHub 的最新记录。';toast('已拉取最新记录');}catch(e){$('publish-message').textContent=e.message;}finally{setBusy(false);}
  }
  function wireEvents() {
    $('continents').replaceChildren(...CONTINENTS.map(([id,name])=>{const b=document.createElement('button');b.dataset.continent=id;b.textContent=name;b.onclick=()=>setContinent(id);return b;}));
    $('map-mode').onclick=()=>setMode(false);$('admin-mode').onclick=()=>setMode(true);$('edit-country').onclick=()=>setMode(true);
    $('show-labels').onchange=()=>root?.selectAll('.country-label').attr('display',$('show-labels').checked?null:'none');
    $('zoom-in').onclick=()=>d3.select('#map').transition().duration(200).call(zoom.scaleBy,1.5);$('zoom-out').onclick=()=>d3.select('#map').transition().duration(200).call(zoom.scaleBy,1/1.5);$('zoom-reset').onclick=()=>d3.select('#map').transition().duration(200).call(zoom.transform,d3.zoomIdentity);
    $('country-search').oninput=search;$('country-search').onkeydown=e=>{if(e.key==='Enter'){$('search-results').querySelector('button')?.click();}if(e.key==='Escape')$('search-results').hidden=true;};$('clear-search').onclick=()=>{$('country-search').value='';search();};
    $('editor').onsubmit=e=>{e.preventDefault();const status=new FormData($('editor')).get('status')||'none';documentData.countries[selected]={...record(selected),status,date:$('travel-date').value,note:$('country-note').value};persist();renderCountry();};
    $('palette-button').onclick=openPalette;$('palette-form').onsubmit=e=>{e.preventDefault();const form=new FormData(e.target);documentData.palette=documentData.palette.map(p=>({...p,color:form.get(p.id+'-color'),label:form.get(p.id+'-label').trim()||p.label}));persist('颜色设置已保存');renderCountry();$('palette-dialog').close();};
    $('export-button').onclick=exportBackup;$('import-button').onclick=()=>{$('import-file').value='';$('import-file').click();};$('import-file').onchange=async e=>{const file=e.target.files[0];if(!file)return;try{if(file.size>2000000)throw Error('备份文件超过 2 MB，请检查文件。');const incoming=validate(JSON.parse(await file.text()));if(!confirm('导入会替换当前浏览器的颜色和记录。继续导入？'))return;documentData=incoming;persist('备份已导入');renderCountry();}catch(error){toast(error.message);}};
    $('publish').onclick=()=>{$('publish-message').textContent='';$('github-dialog').showModal();};$('confirm-publish').onclick=publish;$('pull-remote').onclick=pullRemote;$('credits-button').onclick=()=>$('credits-dialog').showModal();document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$(b.dataset.close).close());
    window.addEventListener('hashchange',()=>setMode(location.hash==='#admin'));let resizeTimer;new ResizeObserver(()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(drawMap,120);}).observe($('map-stage'));
  }
  async function init() {
    try{
      const [metaResponse,geoResponse,dataResponse]=await Promise.all([fetch('./data/countries.json'),fetch('./data/world.geojson'),fetch('./data/atlas.json',{cache:'no-store'})]);if(!metaResponse.ok||!geoResponse.ok||!dataResponse.ok)throw Error('地图数据加载失败，请刷新网页。');
      metadata=await metaResponse.json();geometry=await geoResponse.json();documentData=validate(await dataResponse.json());baseline=copy(documentData);setSaveStatus('已加载网页记录');
      try{const saved=JSON.parse(localStorage.getItem(LOCAL_KEY));if(saved){documentData=validate(saved.data);baseline=validate(saved.baseline);setSaveStatus('已加载本机记录');}}catch{toast('旧本机记录无法读取，已使用网页记录。');}
      wireEvents();setContinent('Europe');setMode(location.hash==='#admin');
    }catch(e){$('map-error').hidden=false;$('map-error').textContent=e.message;setSaveStatus('加载失败');}
  }
  init();
})();
