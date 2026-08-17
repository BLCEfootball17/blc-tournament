
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getDatabase, ref, onValue, set, update, remove, push, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";
import { firebaseConfig, ADMIN_EMAIL } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

const $ = id => document.getElementById(id);
const el = (tag, cls="", text="") => { const n=document.createElement(tag); if(cls)n.className=cls; if(text)n.textContent=text; return n; };
const safe = v => String(v ?? "");
const statusText = {registration:"กำลังรับสมัคร",active:"กำลังแข่งขัน",finished:"จบการแข่งขัน"};
let tournaments = {};
let announcement = "";
let liveMatch = null;
let pendingHomeImage;
let pendingAwayImage;
let currentTournamentId = null;
let currentGroup = "A";
let editingTournamentId = null;
let confirmResolver = null;

function toast(msg){
  $("toast").textContent=msg; $("toast").classList.remove("hidden");
  clearTimeout(window.__toastTimer); window.__toastTimer=setTimeout(()=>$("toast").classList.add("hidden"),2200);
}
function show(view){
  const target=$(view);
  ["homeView","tournamentView","adminView"].forEach(id=>{if(id!==view)$(id).classList.add("hidden")});
  target.classList.remove("hidden","blc-enter"); requestAnimationFrame(()=>target.classList.add("blc-enter"));
  window.scrollTo({top:0,behavior:"auto"});
}
function setConnection(ok){
  const b=$("connectionBadge"); b.classList.toggle("online",ok); b.classList.toggle("offline",!ok);
  b.lastElementChild.textContent=ok?"ออนไลน์":"ออฟไลน์";
}
function groupLetters(n){ return Array.from({length:n},(_,i)=>String.fromCharCode(65+i)); }
function sizeSpec(size){
  size=Number(size);
  if(size===24)return {groups:8,per:3,label:"8 กลุ่ม • กลุ่มละ 3 ทีม"};
  if(size===48)return {groups:12,per:4,label:"12 กลุ่ม • กลุ่มละ 4 ทีม"};
  return {groups:16,per:4,label:"16 กลุ่ม • กลุ่มละ 4 ทีม"};
}
function normalizeTournament(t){
  if(!t)return null;
  t.size=Number(t.size||24); t.status=t.status||"registration"; t.groups=t.groups||{};
  const s=sizeSpec(t.size);
  groupLetters(s.groups).forEach(g=>{
    if(!t.groups[g]) t.groups[g]={players:Array(s.per).fill(""),matches:{}};
    if(!Array.isArray(t.groups[g].players)){
      const obj=t.groups[g].players||{}; t.groups[g].players=Object.keys(obj).sort().map(k=>obj[k]);
    }
    while(t.groups[g].players.length<s.per)t.groups[g].players.push("");
    t.groups[g].players=t.groups[g].players.slice(0,s.per);
  });
  return t;
}
function makeMatches(players){
  const out=[];
  for(let i=0;i<players.length;i++)for(let j=i+1;j<players.length;j++)out.push({i,j,key:`${i}_${j}`});
  return out;
}
function compute(group){
  const players=(group?.players||[]).map((name,i)=>({i,name:name||`ผู้เล่น ${i+1}`,p:0,w:0,d:0,l:0,gf:0,ga:0,gd:0,pts:0}));
  const matches=group?.matches||{};
  for(const m of makeMatches(players)){
    const r=matches[m.key]; if(!r||r.home===""||r.away===""||r.home==null||r.away==null)continue;
    const a=Number(r.home),b=Number(r.away); if(!Number.isFinite(a)||!Number.isFinite(b))continue;
    const A=players[m.i],B=players[m.j]; A.p++;B.p++;A.gf+=a;A.ga+=b;B.gf+=b;B.ga+=a;
    if(a>b){A.w++;B.l++;A.pts+=3}else if(a<b){B.w++;A.l++;B.pts+=3}else{A.d++;B.d++;A.pts++;B.pts++}
  }
  players.forEach(x=>x.gd=x.gf-x.ga);
  return players.sort((a,b)=>b.pts-a.pts||b.gd-a.gd||b.gf-a.gf||a.name.localeCompare(b.name,"th"));
}

function blcAvatar(id,image,name){const b=$(id);if(!b)return;b.innerHTML="";if(image){const i=new Image();i.src=image;i.alt=safe(name);b.appendChild(i)}else{const s=document.createElement("span");s.textContent=(safe(name).trim().split(/\s+/).map(x=>x[0]||"").join("").slice(0,3)||"BLC").toUpperCase();b.appendChild(s)}}
function renderLiveMatch(){const c=$("publicLiveMatchCard");if(!c)return;const l=liveMatch||{},on=l.enabled===true&&(l.homeName||l.awayName);c.classList.toggle("hidden",!on);if(!on)return;$("publicLiveGroup").textContent=`GROUP ${safe(l.group||"A")}`;$("publicHomeName").textContent=safe(l.homeName||"HOME PLAYER");$("publicAwayName").textContent=safe(l.awayName||"AWAY PLAYER");$("publicHomeClub").textContent=l.homeClub?`CLUB (${safe(l.homeClub)})`:"";$("publicAwayClub").textContent=l.awayClub?`CLUB (${safe(l.awayClub)})`:"";$("publicHomeScore").textContent=Number(l.homeScore||0);$("publicAwayScore").textContent=Number(l.awayScore||0);blcAvatar("publicHomeAvatar",l.homeImage,l.homeName);blcAvatar("publicAwayAvatar",l.awayImage,l.awayName);c.classList.remove("blc-live-update");requestAnimationFrame(()=>c.classList.add("blc-live-update"))}
function populateLiveTournamentOptions(){const s=$("liveTournamentSelect");if(!s)return;const keep=s.value||liveMatch?.tournamentId||"";s.innerHTML="";Object.entries(tournaments).forEach(([id,raw])=>{const t=normalizeTournament(structuredClone(raw)),o=document.createElement("option");o.value=id;o.textContent=t.name||`${t.size} TEAM`;s.appendChild(o)});if([...s.options].some(o=>o.value===keep))s.value=keep;populateLiveGroups()}
function populateLiveGroups(){const tid=$("liveTournamentSelect")?.value,s=$("liveGroupSelect");if(!s)return;const t=tournaments[tid]?normalizeTournament(structuredClone(tournaments[tid])):null,keep=s.value||liveMatch?.group||"A";s.innerHTML="";Object.keys(t?.groups||{}).forEach(g=>{const o=document.createElement("option");o.value=g;o.textContent=`GROUP ${g}`;s.appendChild(o)});if([...s.options].some(o=>o.value===keep))s.value=keep;populateLivePlayers()}
function populateLivePlayers(){const tid=$("liveTournamentSelect")?.value,g=$("liveGroupSelect")?.value,t=tournaments[tid]?normalizeTournament(structuredClone(tournaments[tid])):null,p=t?.groups?.[g]?.players||[];[["liveHomePlayer",liveMatch?.homeName],["liveAwayPlayer",liveMatch?.awayName]].forEach(([id,w],i)=>{const s=$(id),keep=s.value||w||"";s.innerHTML="";p.forEach((n,j)=>{const o=document.createElement("option");o.value=n||`ผู้เล่น ${j+1}`;o.textContent=n||`ผู้เล่น ${j+1}`;s.appendChild(o)});if([...s.options].some(o=>o.value===keep))s.value=keep;else if(s.options.length)s.selectedIndex=Math.min(i,s.options.length-1)})}
function fillLiveAdmin(){if(!$("liveHomeClub"))return;const l=liveMatch||{};if(l.tournamentId)$("liveTournamentSelect").value=l.tournamentId;populateLiveGroups();if(l.group&&[...$("liveGroupSelect").options].some(o=>o.value===l.group))$("liveGroupSelect").value=l.group;populateLivePlayers();if(l.homeName&&[...$("liveHomePlayer").options].some(o=>o.value===l.homeName))$("liveHomePlayer").value=l.homeName;if(l.awayName&&[...$("liveAwayPlayer").options].some(o=>o.value===l.awayName))$("liveAwayPlayer").value=l.awayName;$("liveHomeClub").value=l.homeClub||"";$("liveAwayClub").value=l.awayClub||"";$("liveHomeScore").value=Number(l.homeScore||0);$("liveAwayScore").value=Number(l.awayScore||0);blcAvatar("liveHomePreview",l.homeImage,l.homeName);blcAvatar("liveAwayPreview",l.awayImage,l.awayName)}
async function compressLiveImage(file){if(!file||!file.type.startsWith("image/"))throw 0;const u=await new Promise((r,j)=>{const f=new FileReader();f.onload=()=>r(f.result);f.onerror=j;f.readAsDataURL(file)}),im=await new Promise((r,j)=>{const i=new Image();i.onload=()=>r(i);i.onerror=j;i.src=u}),sc=Math.min(1,360/Math.max(im.width,im.height)),w=Math.max(1,Math.round(im.width*sc)),h=Math.max(1,Math.round(im.height*sc)),c=document.createElement("canvas");c.width=w;c.height=h;c.getContext("2d").drawImage(im,0,0,w,h);return c.toDataURL("image/jpeg",.72)}

function renderHome(){
  $("announcementBox").textContent=announcement||"";
  $("announcementBox").classList.toggle("hidden",!announcement);
  const box=$("tournamentList"); box.innerHTML="";
  const entries=Object.entries(tournaments);
  $("homeEmpty").classList.toggle("hidden",entries.length>0);
  for(const [id,raw] of entries){
    const t=normalizeTournament(structuredClone(raw));
    const c=el("div","panel tournament-card");
    c.innerHTML=`<span class="kicker">${t.size} TEAM</span><h3>${safe(t.name)}</h3>
      <div class="muted">${sizeSpec(t.size).label}</div>
      <div style="margin-top:12px"><span class="status-pill status-${t.status}">${statusText[t.status]||t.status}</span></div>`;
    c.onclick=()=>openTournament(id); box.appendChild(c);
  }
  $("metricTotal").textContent=entries.length;
  $("metricActive").textContent=entries.filter(([,t])=>t.status==="active").length;
  $("metricTeams").textContent=entries.reduce((s,[,t])=>s+Number(t.size||0),0);
  renderAdminTournamentList();
  renderLiveMatch();
  populateLiveTournamentOptions();
}
function openTournament(id){
  currentTournamentId=id; const t=normalizeTournament(structuredClone(tournaments[id])); if(!t)return;
  currentGroup=Object.keys(t.groups)[0]||"A"; show("tournamentView"); renderTournament();
}
function renderTournament(){
  const t=normalizeTournament(structuredClone(tournaments[currentTournamentId])); if(!t)return show("homeView");
  $("tourName").textContent=t.name; $("tourMeta").textContent=`${t.size} TEAM • ${sizeSpec(t.size).label}`;
  $("tourStatus").textContent=statusText[t.status]||t.status; $("tourStatus").className=`status-pill status-${t.status}`;
  const tabs=$("groupTabs"); tabs.innerHTML="";
  Object.keys(t.groups).forEach(g=>{const b=el("button","group-tab"+(g===currentGroup?" active":""),`GROUP ${g}`);b.onclick=()=>{if(currentGroup===g)return;currentGroup=g;renderTournament();const p=document.querySelector(".score-panel");if(p){p.classList.remove("blc-score-swap");requestAnimationFrame(()=>p.classList.add("blc-score-swap"))}};tabs.appendChild(b)});
  const group=t.groups[currentGroup]; $("groupLabel").textContent=`GROUP ${currentGroup}`;$("playerCountBadge").textContent=`${group.players.length} PLAYERS`;
  const table=$("standingsBody"); table.innerHTML="";
  compute(group).forEach((x,idx)=>{const tr=el("tr",idx<2?"qualify":"");tr.innerHTML=`<td>${idx+1}</td><td>${safe(x.name)}</td><td>${x.p}</td><td>${x.w}</td><td>${x.d}</td><td>${x.l}</td><td>${x.gf}</td><td>${x.ga}</td><td>${x.gd>0?"+":""}${x.gd}</td><td><b>${x.pts}</b></td>`;table.appendChild(tr)});
  $("qualificationLegend").textContent =
    Number(t.size) === 24
      ? "อันดับ 1–2 เข้ารอบ 16 ทีมสุดท้าย"
      : Number(t.size) === 48
        ? "อันดับ 1–2 เข้ารอบ 32 ทีมสุดท้าย • อันดับ 3 ที่ดีที่สุด 8 ทีม จาก 12 กลุ่ม เข้ารอบเช่นกัน • อันดับตารางคะแนนจะวัดจาก H2H (ผลที่เจอกัน) ก่อนประตูได้เสีย"
        : Number(t.size) === 64
          ? "อันดับ 1–2 เข้ารอบ 32 ทีมสุดท้าย • แต้มเท่ากัน จะนับ H2H (ผลที่เจอกัน) ก่อนผลได้เสีย"
          : "อันดับสูงสุดของแต่ละกลุ่มตามกติกาของรายการ";
  const list=$("matchList"); if(list){list.innerHTML="";list.classList.add("hidden");const h=list.previousElementSibling;if(h)h.classList.add("hidden");} /* public matches hidden */
  for(const m of makeMatches(group.players)){
    const r=(group.matches||{})[m.key]||{}; const row=el("div","match-row");
    row.innerHTML=`<span class="home">${safe(group.players[m.i]||`ผู้เล่น ${m.i+1}`)}</span><b>${r.home ?? "-"}</b><span>:</span><b>${r.away ?? "-"}</b><span>${safe(group.players[m.j]||`ผู้เล่น ${m.j+1}`)}</span>`;
    list.appendChild(row);
  }
}
function renderAdminTournamentList(){
  const box=$("adminTournamentList"); if(!box)return; box.innerHTML="";
  for(const [id,raw] of Object.entries(tournaments)){
    const t=normalizeTournament(structuredClone(raw)); const c=el("div","panel tournament-card");
    c.innerHTML=`<span class="kicker">${t.size} TEAM</span><h3>${safe(t.name)}</h3><div class="muted">${statusText[t.status]}</div>`;
    c.onclick=()=>openEditor(id); box.appendChild(c);
  }
}
function openEditor(id){
  editingTournamentId=id; const t=normalizeTournament(structuredClone(tournaments[id])); if(!t)return;
  $("tournamentEditor").classList.remove("hidden"); $("editorTitle").textContent=t.name;$("editTournamentName").value=t.name;$("editTournamentStatus").value=t.status;
  renderGroupsEditor(t);
}
function renderGroupsEditor(t){
  const box=$("adminGroupsEditor"); box.innerHTML="";
  for(const [g,group] of Object.entries(t.groups)){
    const p=el("div","panel group-editor"); p.innerHTML=`<div class="score-panel-head"><div><span class="kicker">GROUP ${g}</span><h3>ผู้เล่นและผลการแข่งขัน</h3></div><button class="btn btn-primary save-group" data-g="${g}">บันทึกกลุ่ม ${g}</button></div>`;
    const inputs=el("div","player-inputs");
    group.players.forEach((name,i)=>{const lab=el("label","","");lab.innerHTML=`ผู้เล่น ${i+1}<input data-player="${i}" value="${safe(name).replaceAll('"','&quot;')}" placeholder="ชื่อผู้เล่น">`;inputs.appendChild(lab)});p.appendChild(inputs);
    makeMatches(group.players).forEach(m=>{const r=(group.matches||{})[m.key]||{};const row=el("div","match-editor");row.dataset.key=m.key;row.innerHTML=
      `<span>${safe(group.players[m.i]||`ผู้เล่น ${m.i+1}`)}</span><input data-home inputmode="numeric" type="number" min="0" value="${r.home??""}"><span>:</span><input data-away inputmode="numeric" type="number" min="0" value="${r.away??""}"><span>${safe(group.players[m.j]||`ผู้เล่น ${m.j+1}`)}</span>`;p.appendChild(row)});
    p.querySelector(".save-group").onclick=()=>saveGroup(g,p);box.appendChild(p);
  }
}
async function saveGroup(g,panel){
  const t=normalizeTournament(structuredClone(tournaments[editingTournamentId])); const players=[...panel.querySelectorAll("[data-player]")].map(i=>i.value.trim());
  const matches={}; panel.querySelectorAll(".match-editor").forEach(row=>{const h=row.querySelector("[data-home]").value,a=row.querySelector("[data-away]").value;if(h!==""&&a!=="")matches[row.dataset.key]={home:Number(h),away:Number(a)}});
  await set(ref(db,`tournaments/${editingTournamentId}/groups/${g}`),{players,matches}); toast(`บันทึกกลุ่ม ${g} แล้ว`);
}
function switchAdminTab(name){
  document.querySelectorAll(".admin-tab").forEach(x=>x.classList.add("hidden")); $(`admin-${name}`).classList.remove("hidden");
  document.querySelectorAll(".admin-nav-btn[data-admin-tab]").forEach(b=>b.classList.toggle("active",b.dataset.adminTab===name));
}
function previewSize(){ $("sizePreview").textContent=sizeSpec($("newTournamentSize").value).label; }
function askConfirm(title,text){$("confirmTitle").textContent=title;$("confirmText").textContent=text;$("confirmModal").classList.remove("hidden");return new Promise(r=>confirmResolver=r)}
function closeConfirm(v){$("confirmModal").classList.add("hidden");if(confirmResolver){confirmResolver(v);confirmResolver=null}}

onValue(ref(db,".info/connected"),snap=>setConnection(snap.val()===true));
onValue(ref(db,"tournaments"),snap=>{
  tournaments=snap.val()||{}; renderHome(); if(currentTournamentId)renderTournament();
  if(editingTournamentId&&tournaments[editingTournamentId]) openEditor(editingTournamentId);
  $("lastSyncText").textContent="อัปเดตล่าสุด "+new Date().toLocaleTimeString("th-TH",{hour:"2-digit",minute:"2-digit"});
});
onValue(ref(db,"public/announcement"),snap=>{announcement=snap.val()||"";renderHome();if($("announcementInput"))$("announcementInput").value=announcement});
onValue(ref(db,"public/liveMatch"),snap=>{liveMatch=snap.val()||null;pendingHomeImage=undefined;pendingAwayImage=undefined;renderLiveMatch();fillLiveAdmin()});

onAuthStateChanged(auth,user=>{
  $("adminEmailBadge").textContent=user?.email||"";
  if(user){$("adminLoginModal").classList.add("hidden")} 
});

$("brandHome").onclick=()=>show("homeView");$("backHomeBtn").onclick=()=>show("homeView");$("adminBackPublic").onclick=()=>show("homeView");
$("adminEntryBtn").onclick=()=>{if(auth.currentUser)show("adminView");else{$("adminPassword").value="";$("loginError").textContent="";$("adminLoginModal").classList.remove("hidden")}};
$("loginCloseBtn").onclick=$("loginBackdrop").onclick=()=>$("adminLoginModal").classList.add("hidden");
$("loginForm").onsubmit=async e=>{e.preventDefault();$("loginError").textContent="";try{await signInWithEmailAndPassword(auth,ADMIN_EMAIL,$("adminPassword").value);show("adminView");toast("เข้าสู่ระบบแอดมินแล้ว")}catch(err){$("loginError").textContent="รหัสผ่านไม่ถูกต้อง หรือไม่สามารถเข้าสู่ระบบได้"}};
$("logoutBtn").onclick=async()=>{await signOut(auth);show("homeView");toast("ออกจากระบบแล้ว")};
document.querySelectorAll(".admin-nav-btn[data-admin-tab]").forEach(b=>b.onclick=()=>switchAdminTab(b.dataset.adminTab));
$("newTournamentSize").onchange=previewSize;previewSize();
if($("liveTournamentSelect")){
 $("liveTournamentSelect").onchange=populateLiveGroups;$("liveGroupSelect").onchange=populateLivePlayers;
 $("liveHomeImage").onchange=async e=>{try{pendingHomeImage=await compressLiveImage(e.target.files?.[0]);blcAvatar("liveHomePreview",pendingHomeImage,$("liveHomePlayer").value);toast("เตรียมรูป HOME แล้ว")}catch{toast("รูป HOME ไม่ถูกต้อง")}};
 $("liveAwayImage").onchange=async e=>{try{pendingAwayImage=await compressLiveImage(e.target.files?.[0]);blcAvatar("liveAwayPreview",pendingAwayImage,$("liveAwayPlayer").value);toast("เตรียมรูป AWAY แล้ว")}catch{toast("รูป AWAY ไม่ถูกต้อง")}};
 $("removeHomeImageBtn").onclick=()=>{pendingHomeImage=null;blcAvatar("liveHomePreview",null,$("liveHomePlayer").value)};$("removeAwayImageBtn").onclick=()=>{pendingAwayImage=null;blcAvatar("liveAwayPreview",null,$("liveAwayPlayer").value)};
 $("saveLiveMatchBtn").onclick=async()=>{if(!auth.currentUser)return toast("กรุณาเข้าสู่ระบบ ADMIN");const old=liveMatch||{},p={enabled:true,tournamentId:$("liveTournamentSelect").value,group:$("liveGroupSelect").value||"A",homeName:$("liveHomePlayer").value||"",awayName:$("liveAwayPlayer").value||"",homeClub:$("liveHomeClub").value.trim(),awayClub:$("liveAwayClub").value.trim(),homeScore:Math.max(0,Number($("liveHomeScore").value||0)),awayScore:Math.max(0,Number($("liveAwayScore").value||0)),homeImage:pendingHomeImage===undefined?(old.homeImage||""):pendingHomeImage,awayImage:pendingAwayImage===undefined?(old.awayImage||""):pendingAwayImage,updatedAt:Date.now()};if(p.homeName&&p.homeName===p.awayName)return toast("HOME / AWAY ต้องเป็นคนละคน");await set(ref(db,"public/liveMatch"),p);toast("LIVE MATCH อัปเดตแล้ว")};
 $("stopLiveMatchBtn").onclick=async()=>{if(!auth.currentUser)return;await update(ref(db,"public/liveMatch"),{enabled:false,updatedAt:Date.now()});toast("หยุด LIVE MATCH แล้ว")};
}

$("createTournamentForm").onsubmit=async e=>{
  e.preventDefault();const name=$("newTournamentName").value.trim();const size=Number($("newTournamentSize").value);const status=$("newTournamentStatus").value;if(!name)return;
  const s=sizeSpec(size),groups={};groupLetters(s.groups).forEach(g=>groups[g]={players:Array(s.per).fill(""),matches:{}});
  const newRef=push(ref(db,"tournaments"));await set(newRef,{name,size,status,groups,createdAt:Date.now()});
  $("newTournamentName").value="";switchAdminTab("manage");toast("สร้างรายการแล้ว");
};
$("announcementForm").onsubmit=async e=>{e.preventDefault();await set(ref(db,"public/announcement"),$("announcementInput").value.trim());toast("บันทึกประกาศแล้ว")};
$("clearAnnouncementBtn").onclick=async()=>{await set(ref(db,"public/announcement"),"");toast("ล้างประกาศแล้ว")};
$("closeEditorBtn").onclick=()=>{editingTournamentId=null;$("tournamentEditor").classList.add("hidden")};
$("saveTournamentMetaBtn").onclick=async()=>{if(!editingTournamentId)return;await update(ref(db,`tournaments/${editingTournamentId}`),{name:$("editTournamentName").value.trim(),status:$("editTournamentStatus").value});toast("บันทึกข้อมูลแล้ว")};
$("deleteTournamentBtn").onclick=async()=>{if(!editingTournamentId)return;const ok=await askConfirm("ลบรายการแข่งขัน","ข้อมูลทีมและผลการแข่งขันทั้งหมดของรายการนี้จะถูกลบ");if(!ok)return;await remove(ref(db,`tournaments/${editingTournamentId}`));editingTournamentId=null;$("tournamentEditor").classList.add("hidden");toast("ลบรายการแล้ว")};
$("confirmCancel").onclick=()=>closeConfirm(false);$("confirmOk").onclick=()=>closeConfirm(true);
