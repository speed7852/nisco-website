const QURAN_API="https://api.alquran.cloud/v1";
const MP3_API="https://www.mp3quran.net/api/v3";
const reciters=[
 {id:"shuraim",name:"Sheikh Saud Al-Shuraim",ar:"سعود الشريم",match:["saud al-shuraim","saud ash-shuraim","saud shuraim"]},
 {id:"ghamdi",name:"Sheikh Saad Al-Ghamdi",ar:"سعد الغامدي",match:["saad al ghamdi","saad al-ghamdi","saad ghamdi"]},
 {id:"dosari",name:"Sheikh Yasser Al-Dosari",ar:"ياسر الدوسري",match:["yasser al-dosari","yasser ad-dosari","yasser dosari"]},
 {id:"afasy",name:"Sheikh Mishary Al-Afasy",ar:"مشاري راشد العفاسي",match:["mishary alafasy","mishari rashid","mishary rashid","mishari al-afasy","mishary al-afasy"]}
];
const defaults={tab:"home",surah:1,ayah:1,reciter:"afasy",goal:10,minutes:0,bookmarks:[],lastDate:"",streak:0,lastRead:"Al-Fatihah · 1:1",speed:1,repeat:false};
let state={...defaults,...JSON.parse(localStorage.getItem("zq-state")||"{}")},surahs=[],ayahs=[],catalog=null,timings=[],downloadBusy=false,activeStarted=false;
const view=document.querySelector("#view"),audio=document.querySelector("#audio"),toastEl=document.querySelector("#toast");
const save=()=>localStorage.setItem("zq-state",JSON.stringify(state));
const pad=n=>String(n).padStart(3,"0");
const today=()=>new Date().toISOString().slice(0,10);
const reciter=()=>reciters.find(r=>r.id===state.reciter)||reciters[3];
const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
function toast(s){toastEl.textContent=s;toastEl.classList.add("show");clearTimeout(toast.timer);toast.timer=setTimeout(()=>toastEl.classList.remove("show"),5000)}
async function getJson(url){const r=await fetch(url);if(!r.ok)throw Error("Content service returned "+r.status);return r.json()}
async function quran(path){const j=await getJson(QURAN_API+path);if(j.code!==200)throw Error(j.status||"Unable to load Quran");return j.data}
async function mp3(path){return getJson(MP3_API+path)}
async function loadCatalog(){
 if(catalog)return catalog;
 try{const j=await mp3("/reciters?language=eng");catalog=j.reciters||[];localStorage.setItem("zq-reciter-catalog",JSON.stringify(catalog));return catalog}
 catch(e){const saved=localStorage.getItem("zq-reciter-catalog");if(saved){catalog=JSON.parse(saved);return catalog}throw e}
}
function norm(s){return String(s||"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim()}
async function getMoshaf(id=state.reciter){
 if(moshafCache[id])return moshafCache[id];
 try{const saved=JSON.parse(localStorage.getItem("zq-moshaf-cache")||"{}");if(saved[id]){moshafCache[id]=saved[id];return moshafCache[id]}}catch{}
 const list=await loadCatalog(),wanted=reciters.find(r=>r.id===id)||reciters[3];
 const match=list.find(x=>wanted.match.some(t=>norm(x.name).includes(norm(t))));
 if(!match)throw Error("The selected reciter was not found in the audio catalogue.");
 const editions=match.moshaf||[];const m=editions.find(x=>x.server&&Number(x.surah_total)>=114)||editions.find(x=>x.server&&Number(x.surah_total)>=1);
 if(!m)throw Error("No audio edition is currently listed for "+wanted.name+".");
 moshafCache[id]={...m,reciterName:match.name};const saved=JSON.parse(localStorage.getItem("zq-moshaf-cache")||"{}");saved[id]=moshafCache[id];localStorage.setItem("zq-moshaf-cache",JSON.stringify(saved));return moshafCache[id];
}
async function getTimings(surah,id){
 const key=state.reciter+":"+surah;
 if(Object.prototype.hasOwnProperty.call(timingCache,key))return timingCache[key];
 try{const saved=localStorage.getItem("zq-timings-"+key);if(saved){timingCache[key]=JSON.parse(saved);return timingCache[key]}}catch{}
 try{
  const j=await mp3(`/ayat_timing?surah=${surah}&read=${id}`);
  const rows=Array.isArray(j)?j:(j.ayat_timing||j.data||j.timings||[]);
  timingCache[key]=rows.map(x=>({ayah:Number(x.ayah||x.ayah_number),start:Number(x.start_time||x.startTime||0),end:Number(x.end_time||x.endTime||0)})).filter(x=>x.ayah&&x.end>x.start);
  localStorage.setItem("zq-timings-"+key,JSON.stringify(timingCache[key]));return timingCache[key];
 }catch{timingCache[key]=[];return []}
}
let currentMoshaf=null,currentAudioUrl="",activeBlobUrl="",activeSourceKey="",timingCache={},moshafCache={};
async function prepareAudio(){
 currentMoshaf=await getMoshaf();
 const coverage=String(currentMoshaf.surah_list||"");
 if(coverage&&!coverage.split(",").map(Number).includes(state.surah))throw Error("This reciter's catalogue does not list this Surah.");
 currentAudioUrl=currentMoshaf.server.replace(/\/$/,"/")+pad(state.surah)+".mp3";
 timings=await getTimings(state.surah,currentMoshaf.id);
 return currentAudioUrl;
}
async function loadSurah(n,force=false){
 if(!force&&state.surah===n&&ayahs.length)return;
 audio.pause();state.surah=n;state.ayah=1;save();
 try{
  try{
   const [ar,en]=await Promise.all([quran(`/surah/${n}/quran-uthmani`),quran(`/surah/${n}/en.sahih`)]);
   ayahs=ar.ayahs.map((a,i)=>({...a,translation:en.ayahs[i]?.text||""}));
   localStorage.setItem("zq-surah-"+n,JSON.stringify(ayahs));
  }catch(networkError){
   const cached=localStorage.getItem("zq-surah-"+n);if(!cached)throw networkError;ayahs=JSON.parse(cached);
  }
  state.lastRead=`${surahs.find(x=>x.number===n)?.englishName||"Surah "+n} · 1:1`;save();render();
 }catch(e){toast(e.message)}
}
function beginSession(){
 if(activeStarted)return;activeStarted=true;
 beginSession.timer=setInterval(()=>{
  if(document.visibilityState==="visible"&&state.tab==="read"){
   if(state.lastDate!==today()){
    const yesterday=new Date(Date.now()-86400000).toISOString().slice(0,10);
    state.streak=state.lastDate===yesterday?state.streak+1:1;state.lastDate=today();state.minutes=0;
   }
   state.minutes++;save();
   if(state.minutes%state.goal===0){toast("Alhamdulillah — daily reading goal reached.");render()}
  }
 },60000);
}
function stopSession(){activeStarted=false;if(beginSession.timer){clearInterval(beginSession.timer);beginSession.timer=null}}
function progress(){return Math.min(100,Math.round(state.minutes/state.goal*100))}
function header(eyebrow,title,extra=""){return `<div class="title"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1></div>${extra}</div>`}
function home(){const s=surahs.find(x=>x.number===state.surah);return `<section><div class="hello"><div><div class="eyebrow">AS-SALAMU ALAIKUM</div><h1>A little Quran,<br><em>every day.</em></h1></div><div class="bism">﷽</div></div><div class="hero"><div class="hero-line"><b>YOUR DAILY JOURNEY</b><span class="streak">🔥 ${state.streak} day streak</span></div><div class="goal"><div><small>Today's reading</small><br><strong>${state.minutes} <small>/ ${state.goal} min</small></strong></div><div class="ring" style="--p:${progress()*3.6}deg"><span>${progress()}%</span></div></div><div class="track"><i style="width:${progress()}%"></i></div><div class="hero-foot"><span>Every ayah is a step forward.</span><button class="light" data-action="continue">Continue →</button></div></div><div class="section"><div><div class="eyebrow">PICK UP WHERE YOU LEFT OFF</div><h2>Continue reading</h2></div></div><button class="continue" data-action="continue"><span class="surah-icon">۞</span><span><b>${esc(s?.englishName||"Al-Fatihah")}</b><small>${esc(state.lastRead)} · Arabic & English</small></span><b>→</b></button><div class="section"><div><div class="eyebrow">MAKE TIME TO LISTEN</div><h2>Your favourite reciters</h2></div><button class="linkbtn" data-tab="listen">View all</button></div><div class="tiles">${reciters.map(r=>`<button class="tile ${r.id===state.reciter?"chosen":""}" data-reciter="${r.id}"><i>♫</i><b>${esc(r.name.replace("Sheikh ",""))}</b><small>${r.ar}</small></button>`).join("")}</div><div class="tip"><span>✧</span><div><b>Small steps, lasting habits</b><p>Choose a goal you can keep, even on your busiest days.</p></div></div></section>`}
function read(){const s=surahs.find(x=>x.number===state.surah);return `<section>${header("THE HOLY QURAN","Read Quran",'<button class="soft" data-tab="listen">♫ Listen</button>')}<div class="picker"><select id="surahSelect">${surahs.map(x=>`<option value="${x.number}" ${x.number===state.surah?"selected":""}>${x.number}. ${esc(x.englishName)} — ${esc(x.englishNameTranslation)}</option>`).join("")}</select></div><div class="banner"><small>${esc(s?.revelationType?.toUpperCase()||"QURAN")} · ${s?.numberOfAyahs||""} AYAT</small><div class="ar" dir="rtl">${esc(s?.name||"الْفَاتِحَة")}</div><h2>${esc(s?.englishName||"Al-Fatihah")}</h2><span>${esc(s?.englishNameTranslation||"The Opening")}</span></div>${ayahs.length?ayahs.map(a=>{const key=`${state.surah}:${a.numberInSurah}`,saved=state.bookmarks.includes(key);return `<article class="ayah ${a.numberInSurah===state.ayah?"active":""}"><div class="ayah-head"><span class="num">${a.numberInSurah}</span><div class="actions"><button data-play-ayah="${a.numberInSurah}" title="Play verse">▶</button><button data-bookmark="${key}" class="${saved?"on":""}" title="Bookmark verse">▣</button></div></div><p class="arabic" dir="rtl" lang="ar">${esc(a.text)}</p><p class="translation">${esc(a.translation)}</p></article>`}).join(""):'<div class="loading">Loading ayahs…</div>'}<div class="row"><button class="outline" data-action="prev-surah" ${state.surah===1?"disabled":""}>← Previous</button><button class="soft" data-action="next-surah" ${state.surah===114?"disabled":""}>Next Surah →</button></div></section>`}
function listen(){const a=ayahs.find(x=>x.numberInSurah===state.ayah);return `<section>${header("LISTEN & REFLECT","Quran audio")}<div class="player"><div class="art">۞<small>القرآن الكريم</small></div><div class="meta"><small>NOW PLAYING</small><h2>${esc(surahs.find(x=>x.number===state.surah)?.englishName||"Al-Fatihah")}</h2><p>Ayah ${state.ayah} · ${ayahs.length||"—"} ayat</p></div><div class="field"><label>RECITER</label><select id="reciterSelect">${reciters.map(r=>`<option value="${r.id}" ${r.id===state.reciter?"selected":""}>${esc(r.name)}</option>`).join("")}</select></div><p class="translation-box">${esc(a?.translation||"Choose a Surah and verse to listen.")}</p><div class="controls"><button data-action="prev-ayah">◀|</button><button class="play" data-action="toggle-audio" aria-label="Play or pause">${audio.paused?"▶":"Ⅱ"}</button><button data-action="next-ayah">|▶</button></div><div class="player-foot"><button data-action="repeat" class="${state.repeat?"on":""}">⟲ Repeat ayah ${state.repeat?"On":"Off"}</button><label>Speed <select id="speedSelect"><option value="0.75">0.75×</option><option value="1">1×</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option></select></label></div><button class="download" data-action="download">${downloadBusy?"Downloading…":"↓ Download this Surah for offline listening"}</button><p class="note">Offline audio is saved on this device. Download availability depends on the recitation provider and browser storage.</p></div><div class="section"><div><div class="eyebrow">CHOOSE A RECITER</div><h2>Listen in their voice</h2></div></div><div class="reciters">${reciters.map(r=>`<button class="reciter ${r.id===state.reciter?"chosen":""}" data-reciter="${r.id}"><i class="surah-icon">♫</i><span><b>${esc(r.name)}</b><small>${r.ar}</small></span><span>${r.id===state.reciter?"✓":"›"}</span></button>`).join("")}</div></section>`}
function saved(){return `<section>${header("YOUR PERSONAL COLLECTION","Saved ayahs")}${state.bookmarks.length?state.bookmarks.map(k=>{const [s,a]=k.split(":").map(Number);return `<button class="saved" data-open-bookmark="${k}"><span class="num">${a}</span><span><b>${esc(surahs.find(x=>x.number===s)?.englishName||"Surah "+s)}</b><small>Surah ${s} · Ayah ${a}</small></span>→</button>`}).join(""):'<div class="empty">▣<h2>No saved ayahs yet</h2><p>Bookmark verses while reading and find them here.</p><button class="soft" data-tab="read">Open Quran</button></div>'}</section>`}
function settings(){return `<section>${header("MAKE IT YOURS","Settings")}<div class="settings"><h3>Daily reading goal</h3><p>Choose a target you can maintain.</p><div class="goals">${[5,10,15,20,30].map(n=>`<button data-goal="${n}" class="${state.goal===n?"selected":""}">${n} min</button>`).join("")}</div></div><div class="settings"><h3>Reading progress</h3><p>${state.minutes} reading minutes logged today. Time counts while the Quran reader is open.</p><button class="outline" data-action="reset-minutes">Reset today's minutes</button></div><div class="settings"><h3>Offline audio storage</h3><p>Download a Surah from Listen. Audio is stored in this browser on this device.</p><button class="outline" data-action="clear-audio">Clear downloaded audio</button></div><div class="settings"><h3>About Zain Quran</h3><p>Arabic Quran text and Sahih International English translation are served by Al Quran Cloud. Reciter audio catalogue and recordings are served by MP3Quran.</p><p class="muted">Your bookmarks and progress remain in this browser. No account or tracking is used.</p></div></section>`}
function render(){stopSession();document.querySelectorAll(".nav button").forEach(b=>b.classList.toggle("active",b.dataset.tab===state.tab));view.innerHTML=state.tab==="home"?home():state.tab==="read"?read():state.tab==="listen"?listen():state.tab==="saved"?saved():settings();if(state.tab==="read")beginSession();if(state.tab==="listen"){const el=document.querySelector("#speedSelect");if(el)el.value=String(state.speed)}}
async function playCurrent(){
 if(!ayahs.length){await loadSurah(state.surah,true);if(!ayahs.length)return}
 try{
  const url=await prepareAudio(),cache=await caches.open("zain-quran-audio"),hit=await cache.match(url);
  let src=url;
  if(hit){
   if(activeSourceKey!==url){if(activeBlobUrl)URL.revokeObjectURL(activeBlobUrl);activeBlobUrl=URL.createObjectURL(await hit.blob());activeSourceKey=url;}
   src=activeBlobUrl;
  }else{
   if(activeBlobUrl)URL.revokeObjectURL(activeBlobUrl);
   activeBlobUrl="";activeSourceKey="";
  }
  if(audio.src!==src){audio.pause();audio.src=src;await new Promise((resolve,reject)=>{audio.onloadedmetadata=resolve;audio.onerror=()=>reject(Error("Audio file could not be loaded."));});}
  const timing=timings.find(x=>x.ayah===state.ayah);
  if(timing)audio.currentTime=timing.start/1000;
  else if(state.ayah!==1){state.ayah=1;save();toast("This recitation is available as a full Surah; verse-level timings are not provided.");}
  audio.playbackRate=state.speed;await audio.play();render();
 }catch(e){toast(e.message+" Try another reciter or check your connection.")}
}
async function downloadSurah(){
 if(!ayahs.length)return toast("Open a Surah first.");
 downloadBusy=true;render();
 try{
  const url=await prepareAudio(),cache=await caches.open("zain-quran-audio");
  if(!await cache.match(url)){
   const r=await fetch(url,{mode:"cors"});if(!r.ok||r.type==="opaque")throw Error("The audio host does not allow this browser to save the file.");
   await cache.put(url,r);
  }
  toast("Surah audio saved for offline listening on this device.");
 }catch(e){toast("Download could not complete: "+e.message)}
 finally{downloadBusy=false;render()}
}
view.addEventListener("click",async e=>{
 const b=e.target.closest("button");if(!b)return;
 if(b.dataset.tab){state.tab=b.dataset.tab;save();render();return}
 if(b.dataset.reciter){state.reciter=b.dataset.reciter;save();render();return}
 if(b.dataset.goal){state.goal=Number(b.dataset.goal);save();render();return}
 if(b.dataset.bookmark){const k=b.dataset.bookmark;state.bookmarks=state.bookmarks.includes(k)?state.bookmarks.filter(x=>x!==k):[...state.bookmarks,k];save();render();return}
 if(b.dataset.openBookmark){const [s,a]=b.dataset.openBookmark.split(":").map(Number);state.surah=s;state.tab="read";save();await loadSurah(s,true);state.ayah=a;state.lastRead=`${surahs.find(x=>x.number===s)?.englishName||"Surah "+s} · ${a}`;save();render();return}
 if(b.dataset.playAyah){state.ayah=Number(b.dataset.playAyah);state.tab="listen";save();render();playCurrent();return}
 switch(b.dataset.action){
 case"continue":state.tab="read";render();break;
 case"prev-surah":if(state.surah>1)await loadSurah(state.surah-1,true);break;
 case"next-surah":if(state.surah<114)await loadSurah(state.surah+1,true);break;
 case"toggle-audio":if(audio.paused)playCurrent();else audio.pause();render();break;
 case"prev-ayah":state.ayah=Math.max(1,state.ayah-1);save();render();playCurrent();break;
 case"next-ayah":state.ayah=Math.min(ayahs.length,state.ayah+1);save();render();playCurrent();break;
 case"repeat":state.repeat=!state.repeat;save();render();break;
 case"download":downloadSurah();break;
 case"reset-minutes":state.minutes=0;save();render();break;
 case"clear-audio":if(confirm("Remove downloaded Quran audio from this device?")){await caches.delete("zain-quran-audio");toast("Offline audio removed.")}break;
 }
});
view.addEventListener("change",async e=>{
 if(e.target.id==="surahSelect"){await loadSurah(Number(e.target.value),true)}
 if(e.target.id==="reciterSelect"){state.reciter=e.target.value;save();audio.pause();render()}
 if(e.target.id==="speedSelect"){state.speed=Number(e.target.value);audio.playbackRate=state.speed;save()}
});
audio.addEventListener("timeupdate",()=>{
 if(audio.paused||!timings.length)return;
 const t=timings.find(x=>x.ayah===state.ayah);
 if(t&&audio.currentTime*1000>=t.end){
  if(state.repeat){audio.currentTime=t.start/1000}
  else if(state.ayah<ayahs.length){state.ayah++;save();render();const next=timings.find(x=>x.ayah===state.ayah);if(next)audio.currentTime=next.start/1000}
 }
});
audio.addEventListener("ended",()=>{if(!timings.length&&state.repeat){audio.currentTime=0;audio.play();return}if(timings.length&&state.ayah<ayahs.length){state.ayah++;save();playCurrent()}else toast("You reached the end of this Surah. Alhamdulillah.")});
audio.addEventListener("play",()=>{const p=document.querySelector(".controls .play");if(p)p.textContent="Ⅱ"});
audio.addEventListener("pause",()=>{const p=document.querySelector(".controls .play");if(p)p.textContent="▶"});
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="hidden")stopSession();else if(state.tab==="read")beginSession()});
window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();window.deferredInstall=e;document.querySelector("#installBtn").classList.remove("hidden")});
document.querySelector("#installBtn").addEventListener("click",async()=>{if(!window.deferredInstall)return;window.deferredInstall.prompt();await window.deferredInstall.userChoice;window.deferredInstall=null;document.querySelector("#installBtn").classList.add("hidden")});
if("serviceWorker"in navigator)window.addEventListener("load",()=>navigator.serviceWorker.register("./sw.js").catch(()=>{}));
(async()=>{try{try{surahs=await quran("/surah");localStorage.setItem("zq-surah-list",JSON.stringify(surahs))}catch(e){const cached=localStorage.getItem("zq-surah-list");if(!cached)throw e;surahs=JSON.parse(cached)}await loadSurah(state.surah,true);render()}catch(e){view.innerHTML=`<div class="empty"><h2>Unable to connect</h2><p>${esc(e.message)}. Connect once to the internet to load Quran text.</p><button class="soft" onclick="location.reload()">Try again</button></div>`}})();
