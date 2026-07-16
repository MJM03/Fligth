'use strict';
const CONFIG={version:'1.0.0',center:[-12.0464,-77.0428],zoom:7,refreshMs:15000,maxRadiusNm:250,api:'https://api.adsb.lol/v2'};
const $=id=>document.getElementById(id);
const state={aircraft:[],filtered:[],markers:new Map(),selected:null,follow:false,timer:null,mapStyle:0,source:'live'};
const map=L.map('map',{zoomControl:false,preferCanvas:true,minZoom:3}).setView(CONFIG.center,CONFIG.zoom);
const tiles=[
 L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:18,attribution:'© OpenStreetMap contributors'}),
 L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',{maxZoom:19,attribution:'© OpenStreetMap © CARTO'})
];
tiles[0].addTo(map);

function planeIcon(a,selected=false){
 const rot=Number(a.track||a.true_heading||0);
 const ground=a.alt_baro==='ground'||a.alt_geom===0;
 return L.divIcon({className:`aircraft-marker ${selected?'selected':''} ${ground?'ground':''}`,html:`<div class="plane-icon" style="transform:rotate(${rot}deg)"><svg viewBox="0 0 24 24"><path d="M21.5 16.1 13.8 12V5.5c0-1-.8-3-1.8-3s-1.8 2-1.8 3V12l-7.7 4.1v1.6l7.7-2.1V20l-2 1.3V22l3.8-.8 3.8.8v-.7l-2-1.3v-4.4l7.7 2.1z"/></svg></div>`,iconSize:[30,30],iconAnchor:[15,15]});
}
function normalize(a,i){
 return {hex:(a.hex||`demo${i}`).replace('~',''),flight:(a.flight||a.r||a.hex||'SIN ID').trim(),r:a.r||'Matrícula no disponible',t:a.t||'Tipo no disponible',
 lat:Number(a.lat),lon:Number(a.lon),alt_baro:a.alt_baro,alt_geom:a.alt_geom,gs:Number(a.gs||0),track:Number(a.track||a.true_heading||0),baro_rate:Number(a.baro_rate||0),
 seen:Number(a.seen||0),category:a.category||'',squawk:a.squawk||'',dbFlags:a.dbFlags||0,origin:a.origin||'—',destination:a.destination||'—'};
}
function demoData(){
 const base=[['LPE2157','OB-2215','A320',-11.80,-77.31,32000,446,152,-64],['LAT2410','CC-BHB','A320',-12.45,-76.88,14800,312,337,-1280],['SKX603','N889SK','E75L',-11.62,-76.72,36000,421,175,0],['JAT782','OB-2190','B38M',-13.18,-76.24,28100,405,318,1152],['LPE2024','OB-2172','A319',-12.06,-77.11,4200,190,170,-960],['AMP155','N780AV','B763',-10.73,-78.01,37000,478,145,0],['LPE2265','OB-2218','A320',-13.53,-77.29,19500,361,350,1408],['AAL918','N839NN','B738',-9.98,-76.92,35000,455,169,0]];
 return base.map((x,i)=>normalize({hex:`D3${(1000+i).toString(16)}`,flight:x[0],r:x[1],t:x[2],lat:x[3],lon:x[4],alt_baro:x[5],gs:x[6],track:x[7],baro_rate:x[8],seen:i*.3},i));
}
function visibleCenterAndRadius(){
 const c=map.getCenter(), b=map.getBounds(), edge=b.getNorthEast();
 const km=map.distance(c,edge)/1000, nm=Math.min(CONFIG.maxRadiusNm,Math.max(25,km/1.852));
 return {lat:c.lat.toFixed(4),lon:c.lng.toFixed(4),dist:Math.round(nm)};
}
async function loadAircraft(manual=false){
 if(manual) showNotice('Actualizando tráfico…');
 const p=visibleCenterAndRadius();
 try{
   const ctrl=new AbortController(); const timeout=setTimeout(()=>ctrl.abort(),9000);
   const res=await fetch(`${CONFIG.api}/lat/${p.lat}/lon/${p.lon}/dist/${p.dist}`,{signal:ctrl.signal,cache:'no-store'});
   clearTimeout(timeout);
   if(!res.ok) throw new Error(`API ${res.status}`);
   const data=await res.json();
   const list=(data.ac||[]).filter(a=>Number.isFinite(Number(a.lat))&&Number.isFinite(Number(a.lon))).map(normalize);
   if(!list.length) throw new Error('Sin posiciones');
   state.aircraft=list; state.source='live'; $('sourceText').textContent='Datos en vivo';
 }catch(err){
   state.aircraft=demoData(); state.source='demo'; $('sourceText').textContent='Modo demostración';
   showNotice('La fuente pública no respondió. Se muestran aeronaves de demostración.',3500);
 }
 applyFilter(); renderAll();
}
function applyFilter(){
 const q=$('searchInput').value.trim().toLowerCase();
 state.filtered=!q?state.aircraft:state.aircraft.filter(a=>`${a.flight} ${a.r} ${a.hex} ${a.t}`.toLowerCase().includes(q));
 $('clearSearch').style.display=q?'block':'none';
}
function renderAll(){renderMarkers();renderList();renderStats(); if(state.selected){const fresh=state.aircraft.find(a=>a.hex===state.selected.hex);if(fresh){state.selected=fresh;updateSheet(fresh);if(state.follow)map.panTo([fresh.lat,fresh.lon]);}}}
function renderMarkers(){
 const present=new Set();
 state.filtered.forEach(a=>{
   present.add(a.hex);
   let marker=state.markers.get(a.hex);
   if(!marker){marker=L.marker([a.lat,a.lon],{icon:planeIcon(a,state.selected?.hex===a.hex),zIndexOffset:state.selected?.hex===a.hex?1000:0}).addTo(map);marker.on('click',()=>selectAircraft(a.hex));state.markers.set(a.hex,marker);}
   else{marker.setLatLng([a.lat,a.lon]);marker.setIcon(planeIcon(a,state.selected?.hex===a.hex));}
 });
 for(const [hex,m] of state.markers)if(!present.has(hex)){map.removeLayer(m);state.markers.delete(hex);}
}
function renderList(){
 $('aircraftList').innerHTML=state.filtered.slice(0,150).map(a=>`<div class="aircraft-card ${state.selected?.hex===a.hex?'selected':''}" data-hex="${a.hex}"><div class="list-plane" style="--rotation:${a.track}deg">✈</div><div class="info"><h3>${esc(a.flight)}</h3><p>${esc(a.r)} · ${esc(a.t)}</p></div><div class="metrics"><b>${formatAlt(a)} ft</b><span>${Math.round(a.gs||0)} kt</span></div></div>`).join('')||'<div style="padding:30px;text-align:center;color:#8298ac;font-size:12px">No se encontraron aeronaves.</div>';
 document.querySelectorAll('.aircraft-card[data-hex]').forEach(el=>el.onclick=()=>selectAircraft(el.dataset.hex));
}
function renderStats(){
 const airborne=state.filtered.filter(a=>a.alt_baro!=='ground'&&Number(a.alt_baro||a.alt_geom)>500);
 const avg=airborne.length?Math.round(airborne.reduce((s,a)=>s+Number(a.alt_baro||a.alt_geom||0),0)/airborne.length/100)*100:0;
 $('aircraftCount').textContent=state.filtered.length;$('airborneCount').textContent=airborne.length;$('avgAltitude').textContent=avg?`${Math.round(avg/1000)}k`:'—';
}
function selectAircraft(hex){
 const a=state.aircraft.find(x=>x.hex===hex);if(!a)return;state.selected=a;updateSheet(a);$('flightSheet').classList.add('open');map.panTo([a.lat,a.lon]);renderMarkers();renderList();
}
function updateSheet(a){
 $('flightCallsign').textContent=a.flight;$('flightReg').textContent=`${a.r} · ${a.t}`;$('altitude').textContent=formatAlt(a);$('speed').textContent=Math.round(a.gs||0);$('heading').textContent=Math.round(a.track||0).toString().padStart(3,'0');$('verticalRate').textContent=Math.round(a.baro_rate||0);$('hex').textContent=a.hex.toUpperCase();$('aircraftType').textContent=a.t;$('position').textContent=`${a.lat.toFixed(4)}, ${a.lon.toFixed(4)}`;$('lastSeen').textContent=a.seen<2?'Ahora':`Hace ${Math.round(a.seen)} s`;$('origin').textContent=a.origin;$('destination').textContent=a.destination;
}
function formatAlt(a){if(a.alt_baro==='ground')return 'GND';return Math.round(Number(a.alt_baro||a.alt_geom||0)).toLocaleString('en-US')}
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]))}
function showNotice(msg,ms=1800){const n=$('notice');n.textContent=msg;n.classList.remove('hidden');clearTimeout(n._t);n._t=setTimeout(()=>n.classList.add('hidden'),ms)}
function openModal(title,html){$('modalTitle').textContent=title;$('modalBody').innerHTML=html;$('modal').classList.remove('hidden')}
$('searchInput').addEventListener('input',()=>{applyFilter();renderAll()});$('clearSearch').onclick=()=>{$('searchInput').value='';applyFilter();renderAll()};
$('refreshBtn').onclick=()=>loadAircraft(true);$('desktopRefresh').onclick=()=>loadAircraft(true);
$('locateBtn').onclick=()=>navigator.geolocation?navigator.geolocation.getCurrentPosition(p=>{map.flyTo([p.coords.latitude,p.coords.longitude],9);setTimeout(()=>loadAircraft(true),1000)},()=>showNotice('No se pudo obtener tu ubicación.')):showNotice('Geolocalización no disponible.');
$('layersBtn').onclick=()=>{map.removeLayer(tiles[state.mapStyle]);state.mapStyle=(state.mapStyle+1)%tiles.length;tiles[state.mapStyle].addTo(map)};
$('closeSheet').onclick=()=>{$('flightSheet').classList.remove('open');state.follow=false;$('followBtn').classList.remove('active')};
$('followBtn').onclick=()=>{state.follow=!state.follow;$('followBtn').classList.toggle('active',state.follow);$('followBtn').textContent=state.follow?'Siguiendo':'Seguir';if(state.follow&&state.selected)map.panTo([state.selected.lat,state.selected.lon])};
$('listTab').onclick=()=>openModal('Vuelos visibles',`<div class="flight-modal-list">${$('aircraftList').innerHTML}</div>`);
$('favoritesTab').onclick=()=>openModal('Favoritos','<p style="color:#90a6ba;font-size:13px;line-height:1.6">El módulo de favoritos quedará conectado en la siguiente versión. Permitirá guardar matrículas y recibir alertas visuales cuando aparezcan en el área.</p>');
$('settingsTab').onclick=()=>openModal('Ajustes',`<div class="settings-group"><label>Intervalo de actualización</label><select id="intervalSelect"><option value="10000">10 segundos</option><option value="15000" selected>15 segundos</option><option value="30000">30 segundos</option></select></div><div class="settings-group"><label>Fuente principal</label><select disabled><option>ADSB.lol Open Data</option></select></div><p style="font-size:10px;color:#7890a7;line-height:1.5">Las rutas comerciales y aeropuertos de origen/destino requieren una fuente adicional. Esta versión muestra telemetría ADS-B disponible.</p>`);
$('modalClose').onclick=()=>$('modal').classList.add('hidden');$('modal').onclick=e=>{if(e.target===$('modal'))$('modal').classList.add('hidden')};
map.on('moveend',()=>{clearTimeout(map._reload);map._reload=setTimeout(()=>loadAircraft(false),800)});
document.addEventListener('click',e=>{const card=e.target.closest('.flight-modal-list .aircraft-card[data-hex]');if(card){$('modal').classList.add('hidden');selectAircraft(card.dataset.hex)}});
if('serviceWorker' in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
loadAircraft();state.timer=setInterval(()=>loadAircraft(false),CONFIG.refreshMs);
