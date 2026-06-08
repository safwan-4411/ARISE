'use strict';

/* ── SUPABASE ── */
let sb = null, currentUser = null;
function initSupabase() {
  const cfg = window.JRNL_SUPABASE;
  if (cfg?.url && cfg?.anon) {
    try { sb = supabase.createClient(cfg.url, cfg.anon); } catch(e){}
  }
}

/* ── PWA ── */
let deferredInstall = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredInstall = e;
  const btn = document.getElementById('install-btn');
  if(btn) btn.style.display = 'inline-flex';
});
window.addEventListener('appinstalled', () => {
  deferredInstall = null;
  const btn = document.getElementById('install-btn');
  if(btn) btn.style.display = 'none';
  showToast('ARISE installed successfully!');
});
function handleInstall() {
  if (!deferredInstall) {
    // Fallback: show instructions
    showToast('Tap browser menu → Add to Home Screen');
    return;
  }
  deferredInstall.prompt();
  deferredInstall.userChoice.then(choice => {
    if(choice.outcome === 'accepted') showToast('Installing ARISE...');
    deferredInstall = null;
    const btn = document.getElementById('install-btn');
    if(btn) btn.style.display = 'none';
  });
}
// Show install btn on mobile browsers that support it
window.addEventListener('load', () => {
  const isMobile = /Android|iPhone|iPad/i.test(navigator.userAgent);
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
  if(isMobile && !isStandalone) {
    // Show after 3 seconds if beforeinstallprompt hasn't fired
    setTimeout(() => {
      const btn = document.getElementById('install-btn');
      if(btn && btn.style.display === 'none') btn.style.display = 'inline-flex';
    }, 3000);
  }
});

/* ── STORAGE ── */
const LS_KEY='arise_entries', LS_TODOS='arise_todos', LS_HOBBIES='arise_hobbies',
      LS_HOBBY_LOG='arise_hobby_log', LS_MONEY='arise_money', LS_MONEY_LOG='arise_money_log',
      LS_FITNESS='arise_fitness', LS_FIT_LOG='arise_fit_log', LS_TIME='arise_time_log';
function lsGet(k,d){ try { return JSON.parse(localStorage.getItem(k))??d; } catch { return d; } }
function lsSet(k,v){ localStorage.setItem(k, JSON.stringify(v)); }
function getEntries(){ return lsGet(LS_KEY,[]); }
function saveEntries(e){ lsSet(LS_KEY,e); }

/* ── UTILS ── */
function uid(){ return Date.now().toString(36)+Math.random().toString(36).slice(2,6); }
function todayStr(){ return new Date().toISOString().slice(0,10); }
function fmtLong(s){ return new Date(s+'T00:00:00').toLocaleDateString('en-IN',{weekday:'long',year:'numeric',month:'long',day:'numeric'}); }
function fmtShort(s){ return new Date(s+'T00:00:00').toLocaleDateString('en-IN',{weekday:'short',month:'short',day:'numeric',year:'numeric'}); }
function fmtMonth(s){ return new Date(s+'T00:00:00').toLocaleDateString('en-IN',{month:'long',year:'numeric'}); }
function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function inrFmt(n){ return '₹'+Number(n).toLocaleString('en-IN'); }

/* ── IMAGE UTILS ── */
function resizeImage(file, maxW=1200, quality=0.78){
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        let w=img.width, h=img.height;
        if(w>maxW){ h=Math.round(h*maxW/w); w=maxW; }
        const canvas=document.createElement('canvas');
        canvas.width=w; canvas.height=h;
        canvas.getContext('2d').drawImage(img,0,0,w,h);
        resolve(canvas.toDataURL('image/jpeg',quality));
      };
      img.src=e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

/* ── ENTRY OPS ── */
function getEntry(id){ return getEntries().find(e=>e.id===id); }
function getEntryByDate(date){ return getEntries().find(e=>e.entry_date===date)||null; }
function createEntry(date){
  const entry={id:uid(),entry_date:date,title:'',content:'',images:[],
    created_at:new Date().toISOString(),updated_at:new Date().toISOString()};
  const entries=getEntries(); entries.unshift(entry); saveEntries(entries); return entry;
}
function updateEntry(id, patch){
  const entries=getEntries(), idx=entries.findIndex(e=>e.id===id);
  if(idx===-1) return;
  entries[idx]={...entries[idx],...patch,updated_at:new Date().toISOString()};
  saveEntries(entries); syncEntry(entries[idx]); return entries[idx];
}
function deleteEntryById(id){
  saveEntries(getEntries().filter(e=>e.id!==id));
  if(sb&&currentUser) sb.from('journal_entries').delete().eq('entry_id',id).then(()=>{});
}

/* ── CLOUD SYNC ── */
async function syncEntry(entry){
  if(!sb||!currentUser) return;
  try { await sb.from('journal_entries').upsert({entry_id:entry.id,user_id:currentUser.id,
    title:entry.title,content:entry.content,entry_date:entry.entry_date,
    images:JSON.stringify(entry.images),updated_at:entry.updated_at},{onConflict:'entry_id'}); } catch(e){}
}
async function loadFromCloud(){
  if(!sb||!currentUser) return;
  try {
    const {data}=await sb.from('journal_entries').select('*').eq('user_id',currentUser.id).order('entry_date',{ascending:false});
    if(!data||!data.length) return;
    saveEntries(data.map(r=>({id:r.entry_id,entry_date:r.entry_date,title:r.title||'',content:r.content||'',
      images:typeof r.images==='string'?JSON.parse(r.images):(r.images||[]),
      created_at:r.created_at,updated_at:r.updated_at})));
  } catch(e){}
}

/* ── AUTH ── */
async function signInWithGoogle(){
  if(!sb){showToast('Using local storage — no Supabase configured.');return;}
  const {error}=await sb.auth.signInWithOAuth({provider:'google',options:{redirectTo:window.location.href}});
  if(error) showToast('Sign-in error: '+error.message);
}
async function signOut(){ if(sb) await sb.auth.signOut(); currentUser=null; renderNav(); showToast('Signed out'); }

/* ── ROUTING ── */
let currentPage='today', viewEntryId=null, _searchQ='', _editMode=false;
const PAGES=['today','entries','view','money','fitness','time'];
function navTo(page,id){ currentPage=page; if(id) viewEntryId=id; renderRoute(); }
function renderRoute(){
  PAGES.forEach(p=>{ const el=document.getElementById('page-'+p); if(el) el.classList.toggle('hidden',currentPage!==p); });
  renderNav();
  if(currentPage==='today')   renderToday();
  if(currentPage==='entries'){_editMode=false;renderEntries();}
  if(currentPage==='view')    renderView();
  if(currentPage==='money')   renderMoney();
  if(currentPage==='fitness') renderFitness();
  if(currentPage==='time')    renderTime();
}

/* ── NAV ── */
function renderNav(){
  const items=[
    {id:'today',label:'Today',icon:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>`},
    {id:'entries',label:'Journal',icon:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>`},
    {id:'money',label:'Money',icon:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>`},
    {id:'fitness',label:'Fitness',icon:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/></svg>`},
    {id:'time',label:'Time',icon:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`},
  ];
  const html=items.map(n=>`<button class="nav-item${currentPage===n.id||(currentPage==='view'&&n.id==='entries')?' active':''}" onclick="navTo('${n.id}')">${n.icon}${n.label}</button>`).join('');
  document.getElementById('main-nav').innerHTML=html;
  document.getElementById('mobile-nav').innerHTML=html;
  const signinBtn=document.getElementById('signin-btn'), userBadge=document.getElementById('user-badge');
  if(currentUser){
    signinBtn?.classList.add('hidden');
    const name=currentUser.user_metadata?.full_name||currentUser.email||'U';
    const avatar=currentUser.user_metadata?.avatar_url;
    userBadge.classList.remove('hidden');
    userBadge.innerHTML=avatar?`<img src="${esc(avatar)}" title="Sign out" onclick="signOut()"/>`:`<div class="avatar-initials" onclick="signOut()" title="Sign out">${esc(name[0].toUpperCase())}</div>`;
  } else { signinBtn?.classList.remove('hidden'); userBadge.classList.add('hidden'); }
}

/* ════════════════════════════════════════
   TODAY PAGE
════════════════════════════════════════ */
let _currentEntryId=null, _autoSaveTimer=null;

function renderToday(){
  const el=document.getElementById('page-today');
  let entry=getEntryByDate(todayStr());
  if(!entry) entry=createEntry(todayStr());
  _currentEntryId=entry.id;

  const todos=getTodos();
  const hobbies=getActiveHobbies();
  const hobbyLog=getHobbyLog(todayStr());
  const todoDone=todos.filter(t=>t.done).length;
  const hobbiesDone=hobbies.filter(h=>hobbyLog[h.id]).length;
  const hasEntry=(entry.content||'').trim().length>0;
  const journalPct=hasEntry?100:0;
  const todoPct=todos.length?Math.round(todoDone/todos.length*100):0;
  const hobbyPct=hobbies.length?Math.round(hobbiesDone/hobbies.length*100):0;
  const overallPct=Math.round((journalPct+todoPct+hobbyPct)/3);
  const streak=calcStreak();

  el.innerHTML=`
  <div class="today-grid">
    <div class="today-left">
      <div class="today-banner">
        <div style="position:relative;z-index:1">
          <div class="banner-online"><span class="dot"></span>SYSTEM ONLINE</div>
          <div class="banner-date">${new Date().toLocaleDateString('en-IN',{weekday:'long',month:'long',day:'numeric'})}</div>
          <div class="banner-sub">DAY ${getDayOfYear()} · WEEK ${getWeekNum()} · ${new Date().getFullYear()}</div>
        </div>
        <div class="banner-stats" style="position:relative;z-index:1">
          <div class="stat-box sc"><div class="snum">🔥${streak}</div><div class="slbl">Streak</div></div>
          <div class="stat-box sp"><div class="snum">${overallPct}%</div><div class="slbl">Today</div></div>
          <div class="stat-box sg"><div class="snum">${todoDone}/${todos.length}</div><div class="slbl">Tasks</div></div>
        </div>
      </div>

      <div class="card bracketed">
        <div class="cbr tl"></div><div class="cbr tr"></div><div class="cbr bl"></div><div class="cbr br"></div>
        <div class="card-header">
          <div class="card-title"><span class="cdot-cyan"></span>Daily Progress</div>
          <span style="font-family:var(--font-m);font-size:12px;color:var(--cyan)" id="overall-pct">${overallPct}%</span>
        </div>
        <div class="prog-row"><span class="prog-label">Journal</span>
          <div class="prog-track"><div class="prog-fill pf-c" id="bar-journal" style="width:0%" data-to="${journalPct}%"></div></div>
          <span class="prog-val">${hasEntry?'1/1':'0/1'}</span></div>
        <div class="prog-row"><span class="prog-label">To-Do</span>
          <div class="prog-track"><div class="prog-fill pf-a" id="bar-todo" style="width:0%" data-to="${todoPct}%"></div></div>
          <span class="prog-val" id="todo-prog-val">${todoDone}/${todos.length}</span></div>
        <div class="prog-row"><span class="prog-label">Hobbies</span>
          <div class="prog-track"><div class="prog-fill pf-p" id="bar-hobby" style="width:0%" data-to="${hobbyPct}%"></div></div>
          <span class="prog-val" id="hobby-prog-val">${hobbiesDone}/${hobbies.length}</span></div>
      </div>

      <div class="entry-card">
        <div class="entry-meta">
          <span class="entry-date-badge mono">${todayStr()}</span>
          <span class="autosave-badge" id="autosave-badge">Saved ✓</span>
        </div>
        <textarea id="entry-title" class="title-input" rows="1" placeholder="Title (optional)…" oninput="autoGrow(this);scheduleAutoSave()">${esc(entry.title)}</textarea>
        <textarea id="entry-content" class="content-textarea" placeholder="Write about your day…" oninput="autoGrow(this);scheduleAutoSave()">${esc(entry.content)}</textarea>
        <div class="entry-images-section">
          <div class="images-toolbar">
            <label class="img-upload-label" for="img-file-input">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>Add Photos
            </label>
            <input type="file" id="img-file-input" accept="image/*" multiple style="display:none" onchange="handleImageUpload(this)"/>
            <span class="img-count" id="img-count">${entry.images.length>0?entry.images.length+' photo'+(entry.images.length>1?'s':''):''}</span>
          </div>
          <div class="images-grid" id="images-grid">${renderImageThumbs(entry.images)}</div>
        </div>
        <div class="entry-footer">
          <button class="btn-primary btn-sm" onclick="saveNow()">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13"/><polyline points="7 3 7 8 15 8"/></svg>Save Entry
          </button>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <div class="card-title"><span class="cdot-cyan"></span>Writing Activity</div>
          <span style="font-family:var(--font-m);font-size:10px;color:var(--muted-2)">${getEntries().length} entries</span>
        </div>
        <div class="heatmap-grid" id="heatmap-grid"></div>
        <div class="hm-legend"><span>Less</span><div class="hm-lc" style="background:var(--surface-3)"></div><div class="hm-lc hm-1"></div><div class="hm-lc hm-2"></div><div class="hm-lc hm-3"></div><div class="hm-lc hm-4"></div><span>More</span></div>
      </div>
    </div>

    <div class="today-right">
      <div class="card bracketed">
        <div class="cbr tl"></div><div class="cbr tr"></div><div class="cbr bl"></div><div class="cbr br"></div>
        <div class="card-header">
          <div class="card-title"><span class="cdot-amber"></span>Quests / To-Do</div>
          <button class="card-action" onclick="openTodoModal()">+ Add</button>
        </div>
        <div id="todo-list">${renderTodoItems()}</div>
      </div>

      <div class="card">
        <div class="card-header">
          <div class="card-title"><span class="cdot-purple"></span>Hobbies</div>
          <button class="card-action" onclick="openHobbyModal()">Manage</button>
        </div>
        <div class="hobbies-grid" id="hobbies-grid">${renderHobbyCards()}</div>
        <div class="hobby-manage-row">
          <button class="btn-outline btn-sm" onclick="openHobbyModal()" style="font-size:10px;padding:4px 10px">+ Add Hobby</button>
        </div>
      </div>
    </div>
  </div>`;

  setTimeout(()=>{
    autoGrow(document.getElementById('entry-title'));
    autoGrow(document.getElementById('entry-content'));
    document.querySelectorAll('.prog-fill[data-to]').forEach(el=>setTimeout(()=>el.style.width=el.dataset.to,200));
    buildHeatmap();
  },0);
}

function getDayOfYear(){ const n=new Date(),s=new Date(n.getFullYear(),0,0); return Math.floor((n-s)/86400000); }
function getWeekNum(){ const d=new Date(),j=new Date(d.getFullYear(),0,1); return Math.ceil((((d-j)/86400000)+j.getDay()+1)/7); }
function calcStreak(){
  const entries=getEntries(); let streak=0; const d=new Date();
  while(true){ const ds=d.toISOString().slice(0,10); if(!entries.find(e=>e.entry_date===ds&&(e.content||'').trim())) break; streak++; d.setDate(d.getDate()-1); }
  return streak;
}

/* ── autosave ── */
function autoGrow(el){ if(!el) return; el.style.height='auto'; el.style.height=el.scrollHeight+'px'; }
function scheduleAutoSave(){ clearTimeout(_autoSaveTimer); _autoSaveTimer=setTimeout(saveNow,1200); }
function saveNow(){
  if(!_currentEntryId) return;
  updateEntry(_currentEntryId,{title:(document.getElementById('entry-title')?.value||'').trim(),content:document.getElementById('entry-content')?.value||''});
  const b=document.getElementById('autosave-badge'); if(b){b.classList.add('show');setTimeout(()=>b.classList.remove('show'),2000);}
  updateProgressBars();
}
function updateProgressBars(){
  const todos=getTodos(), done=todos.filter(t=>t.done).length;
  const todoPct=todos.length?Math.round(done/todos.length*100):0;
  const bt=document.getElementById('bar-todo'); if(bt) bt.style.width=todoPct+'%';
  const vt=document.getElementById('todo-prog-val'); if(vt) vt.textContent=done+'/'+todos.length;
  const hobbies=getActiveHobbies(), hl=getHobbyLog(todayStr());
  const hDone=hobbies.filter(h=>hl[h.id]).length;
  const hobbyPct=hobbies.length?Math.round(hDone/hobbies.length*100):0;
  const bh=document.getElementById('bar-hobby'); if(bh) bh.style.width=hobbyPct+'%';
  const vh=document.getElementById('hobby-prog-val'); if(vh) vh.textContent=hDone+'/'+hobbies.length;
  const entry=getEntryByDate(todayStr()), jp=(entry&&(entry.content||'').trim())?100:0;
  const bj=document.getElementById('bar-journal'); if(bj) bj.style.width=jp+'%';
  const overall=Math.round((jp+todoPct+hobbyPct)/3);
  const op=document.getElementById('overall-pct'); if(op) op.textContent=overall+'%';
  const sp=document.querySelector('.stat-box.sp .snum'); if(sp) sp.textContent=overall+'%';
  const st=document.querySelector('.stat-box.sg .snum'); if(st) st.textContent=done+'/'+todos.length;
}

/* ── images ── */
async function handleImageUpload(input){
  if(!input.files?.length||!_currentEntryId) return;
  const entry=getEntry(_currentEntryId); if(!entry) return;
  const newImages=[...entry.images];
  for(const file of input.files){ if(!file.type.startsWith('image/')) continue; newImages.push({id:uid(),data:await resizeImage(file),name:file.name}); }
  updateEntry(_currentEntryId,{images:newImages});
  document.getElementById('images-grid').innerHTML=renderImageThumbs(newImages);
  document.getElementById('img-count').textContent=newImages.length+' photo'+(newImages.length!==1?'s':'');
  input.value='';
}
function removeImage(imgId){
  if(!_currentEntryId) return;
  const entry=getEntry(_currentEntryId); if(!entry) return;
  const images=entry.images.filter(i=>i.id!==imgId);
  updateEntry(_currentEntryId,{images});
  document.getElementById('images-grid').innerHTML=renderImageThumbs(images);
  document.getElementById('img-count').textContent=images.length?images.length+' photo'+(images.length!==1?'s':''):'';
}
function renderImageThumbs(images){ return images.map(img=>`<div class="img-thumb-wrap" onclick="openLightbox('${esc(img.data)}')"><img src="${img.data}" alt="${esc(img.name)}" loading="lazy"/><button class="img-remove-btn" onclick="event.stopPropagation();removeImage('${esc(img.id)}')">×</button></div>`).join(''); }

/* ── heatmap ── */
function buildHeatmap(){
  const grid=document.getElementById('heatmap-grid'); if(!grid) return;
  const dateSet={}; getEntries().forEach(e=>{ if(e.content?.trim()) dateSet[e.entry_date]=(dateSet[e.entry_date]||0)+1; });
  const today=new Date(); let html='';
  for(let i=181;i>=0;i--){ const d=new Date(today); d.setDate(d.getDate()-i); const ds=d.toISOString().slice(0,10); const l=Math.min(dateSet[ds]||0,4); html+=`<div class="hm-cell${l?' hm-'+l:''}" title="${ds}"></div>`; }
  grid.innerHTML=html;
}

/* ════════════════════════════════════════
   TO-DO
════════════════════════════════════════ */
function getTodos(){ return lsGet(LS_TODOS,[]); }
function saveTodos(t){ lsSet(LS_TODOS,t); }
function renderTodoItems(){
  const todos=getTodos();
  if(!todos.length) return `<div style="font-size:11px;color:var(--muted-2);text-align:center;padding:12px 0;font-family:var(--font-m)">No quests yet — add one!</div>`;
  return todos.map(t=>`
    <div class="todo-item" id="todo-${t.id}">
      <div class="todo-check${t.done?' done':''}" onclick="toggleTodo('${t.id}')"><svg class="tc-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></div>
      <span class="todo-text${t.done?' done':''}" onclick="toggleTodo('${t.id}')">${esc(t.text)}</span>
      ${t.tag?`<span class="todo-tag-badge tb-${t.tag}">${t.tag}</span>`:''}
      <button class="todo-del" onclick="deleteTodo('${t.id}')">×</button>
    </div>`).join('');
}
function toggleTodo(id){
  const todos=getTodos(), t=todos.find(x=>x.id===id); if(!t) return;
  t.done=!t.done; saveTodos(todos);
  const item=document.getElementById('todo-'+id);
  if(item){ item.querySelector('.todo-check').classList.toggle('done',t.done); item.querySelector('.todo-text').classList.toggle('done',t.done); }
  updateProgressBars();
}
function deleteTodo(id){ saveTodos(getTodos().filter(t=>t.id!==id)); document.getElementById('todo-'+id)?.remove(); updateProgressBars(); }
let _newTodoTag='';
function selectTodoTag(tag,btn){ _newTodoTag=_newTodoTag===tag?'':tag; document.querySelectorAll('#todo-modal .tag-opt').forEach(b=>b.classList.remove('selected')); if(_newTodoTag) btn.classList.add('selected'); }
function openTodoModal(){ _newTodoTag=''; document.getElementById('todo-modal').classList.remove('hidden'); setTimeout(()=>document.getElementById('todo-inp')?.focus(),100); }
function closeTodoModal(e){ if(e&&e.target!==document.getElementById('todo-modal')) return; document.getElementById('todo-modal').classList.add('hidden'); }
function addTodo(){
  const text=(document.getElementById('todo-inp')?.value||'').trim(); if(!text) return;
  const todos=getTodos(); todos.push({id:uid(),text,tag:_newTodoTag,done:false,created:todayStr()});
  saveTodos(todos); document.getElementById('todo-inp').value='';
  document.getElementById('todo-modal').classList.add('hidden');
  document.getElementById('todo-list').innerHTML=renderTodoItems();
  updateProgressBars();
}

/* ════════════════════════════════════════
   HOBBIES
════════════════════════════════════════ */
const HOBBY_COLORS=['c','p','g','a'];
const DEFAULT_HOBBIES=[{id:'h1',emoji:'📚',name:'Reading',color:'c'},{id:'h2',emoji:'🎸',name:'Guitar',color:'p'},{id:'h3',emoji:'🏃',name:'Running',color:'g'},{id:'h4',emoji:'🎨',name:'Drawing',color:'a'}];
function getHobbies(){ return lsGet(LS_HOBBIES,DEFAULT_HOBBIES); }
function saveHobbies(h){ lsSet(LS_HOBBIES,h); }
function getActiveHobbies(){ return getHobbies().filter(h=>!h.removed); }
function getHobbyLog(date){ return lsGet(LS_HOBBY_LOG+':'+date,{}); }
function saveHobbyLog(date,log){ lsSet(LS_HOBBY_LOG+':'+date,log); }
function calcHobbyStreak(hid){ let s=0; const d=new Date(); while(s<365){ const ds=d.toISOString().slice(0,10); if(!getHobbyLog(ds)[hid]) break; s++; d.setDate(d.getDate()-1); } return s; }
function renderHobbyCards(){
  const hobbies=getActiveHobbies();
  if(!hobbies.length) return `<div style="font-size:11px;color:var(--muted-2);grid-column:1/-1;text-align:center;padding:10px;font-family:var(--font-m)">No hobbies — add one!</div>`;
  const log=getHobbyLog(todayStr());
  return hobbies.map(h=>{ const streak=calcHobbyStreak(h.id), logged=!!log[h.id]; return `<div class="hobby-card hc-${h.color}"><span class="hobby-emoji">${h.emoji}</span><div class="hobby-name">${esc(h.name)}</div><div class="hobby-streak">${streak>0?'🔥 '+streak+' day streak':'⚡ Start streak'}</div><div class="hobby-bar-track"><div class="hobby-bar-fill hbf-${h.color}" style="width:${Math.min(100,streak*10)}%"></div></div><button class="hobby-log-btn${logged?' logged':''}" onclick="logHobby('${h.id}',this)">${logged?'✓ Logged':'Log today'}</button></div>`; }).join('');
}
function logHobby(id,btn){ const log=getHobbyLog(todayStr()); if(log[id]) return; log[id]=new Date().toISOString(); saveHobbyLog(todayStr(),log); btn.className='hobby-log-btn logged'; btn.textContent='✓ Logged'; updateProgressBars(); }
function openHobbyModal(){ document.getElementById('hobby-modal').classList.remove('hidden'); renderHobbyModalList(); }
function closeHobbyModal(e){ if(e&&e.target!==document.getElementById('hobby-modal')) return; document.getElementById('hobby-modal').classList.add('hidden'); document.getElementById('hobbies-grid').innerHTML=renderHobbyCards(); updateProgressBars(); }
function renderHobbyModalList(){ const hobbies=getHobbies(); document.getElementById('hobby-modal-list').innerHTML=hobbies.map(h=>`<div class="hobby-modal-item"><span class="hobby-modal-emoji">${h.emoji}</span><span class="hobby-modal-name">${esc(h.name)}${h.removed?'<span style="color:var(--muted-2);font-size:10px"> (removed)</span>':''}</span>${!h.removed?`<button class="hobby-modal-del" onclick="removeHobby('${h.id}')">Remove</button>`:`<button class="hobby-modal-del" style="color:var(--green);border-color:rgba(16,185,129,0.25)" onclick="restoreHobby('${h.id}')">Restore</button>`}</div>`).join(''); }
function removeHobby(id){ const h=getHobbies(), x=h.find(i=>i.id===id); if(x) x.removed=true; saveHobbies(h); renderHobbyModalList(); }
function restoreHobby(id){ const h=getHobbies(), x=h.find(i=>i.id===id); if(x) delete x.removed; saveHobbies(h); renderHobbyModalList(); }
function addHobby(){ const emoji=(document.getElementById('hobby-emoji-inp')?.value.trim())||'⭐', name=(document.getElementById('hobby-name-inp')?.value.trim())||''; if(!name) return; const hobbies=getHobbies(), color=HOBBY_COLORS[hobbies.filter(h=>!h.removed).length%4]; hobbies.push({id:uid(),emoji,name,color}); saveHobbies(hobbies); document.getElementById('hobby-emoji-inp').value=''; document.getElementById('hobby-name-inp').value=''; renderHobbyModalList(); }

/* ════════════════════════════════════════
   JOURNAL ENTRIES LIST
════════════════════════════════════════ */
function renderEntries(){
  const el=document.getElementById('page-entries'), all=getEntries();
  el.innerHTML=`<div class="page-header"><div><h1 class="page-title">Journal</h1><div class="page-subtitle">${all.length} entries</div></div><button class="btn-primary btn-sm" onclick="openNewEntryModal()"><svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>Write for another date</button></div>
  <input type="text" class="entries-search" placeholder="Search entries…" value="${esc(_searchQ)}" oninput="_searchQ=this.value;renderEntriesGrid()"/>
  <div class="entries-grid" id="entries-grid"></div>`;
  renderEntriesGrid();
}
function openNewEntryModal(){
  openModal('Write Entry for Date',`<p style="margin-bottom:12px;font-size:12px;color:var(--muted-1)">Choose a date to write or edit:</p><input type="date" id="new-entry-date" class="todo-text-inp" value="${todayStr()}" max="${todayStr()}"/>`,
    [{label:'Open',cls:'btn-primary',key:'open'},{label:'Cancel',cls:'btn-secondary',key:'cancel'}]);
  _mActs.open=()=>{ const d=document.getElementById('new-entry-date').value; if(!d){showToast('Pick a date');return;} let entry=getEntryByDate(d); if(!entry) entry=createEntry(d); closeModal(); navTo('view',entry.id); _editMode=true; renderView(); };
  _mActs.cancel=closeModal;
}
function renderEntriesGrid(){
  const el=document.getElementById('entries-grid'); if(!el) return;
  const q=_searchQ.toLowerCase().trim();
  const entries=getEntries().filter(e=>!q||e.title.toLowerCase().includes(q)||e.content.toLowerCase().includes(q)).sort((a,b)=>b.entry_date.localeCompare(a.entry_date));
  if(!entries.length){ el.innerHTML=`<div class="empty-state" style="grid-column:1/-1"><svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg><p>${q?'No entries match.':'No entries yet!'}</p></div>`; return; }
  el.innerHTML=entries.map(entry=>{ const hasTitle=entry.title?.trim(), firstImg=entry.images?.[0], imgCount=entry.images?.length||0, preview=entry.content.replace(/\n/g,' ').slice(0,120); return `<div class="entry-list-card" onclick="navTo('view','${esc(entry.id)}')">${firstImg?`<img class="entry-list-thumb" src="${firstImg.data}" alt="" loading="lazy"/>`:''}<div class="entry-list-body"><div class="entry-list-top"><span class="entry-list-date">${esc(fmtShort(entry.entry_date))}</span></div><div class="entry-list-title${hasTitle?'':' no-title'}">${esc(hasTitle?entry.title:'Untitled entry')}</div>${preview?`<div class="entry-list-preview">${esc(preview)}</div>`:''}</div>${imgCount>0?`<div class="entry-list-footer"><span class="entry-list-img-count"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>${imgCount} photo${imgCount!==1?'s':''}</span></div>`:''}</div>`; }).join('');
}

/* ── VIEW / EDIT ENTRY ── */
let _editAutoTimer=null;
function renderView(){ const el=document.getElementById('page-view'), entry=viewEntryId?getEntry(viewEntryId):null; if(!entry){el.innerHTML=`<div class="empty-state"><p>Entry not found.</p></div>`;return;} _editMode?renderEditEntry(el,entry):renderReadEntry(el,entry); }
function renderReadEntry(el,entry){ el.innerHTML=`<div class="page-header"><button class="btn-outline btn-sm" onclick="navTo('entries');_editMode=false"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="11" height="11"><polyline points="15 18 9 12 15 6"/></svg>Journal</button></div><div class="view-entry-card"><div class="view-entry-header"><div class="view-entry-date">${esc(fmtLong(entry.entry_date))}</div><div class="view-entry-title">${esc(entry.title||'Untitled entry')}</div></div><div class="view-entry-content">${esc(entry.content||'')}</div>${entry.images?.length>0?`<div class="view-entry-images">${entry.images.map(img=>`<div class="view-img-wrap" onclick="openLightbox('${esc(img.data)}')"><img src="${img.data}" alt="" loading="lazy"/></div>`).join('')}</div>`:''}<div class="view-entry-actions"><button class="btn-primary btn-sm" onclick="_editMode=true;renderView()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>Edit</button><button class="btn-danger btn-sm" onclick="confirmDelete('${esc(entry.id)}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M9 6V4h6v2"/></svg>Delete</button></div></div>`; }
function renderEditEntry(el,entry){ el.innerHTML=`<div class="page-header"><button class="btn-outline btn-sm" onclick="_editMode=false;renderView()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="11" height="11"><polyline points="15 18 9 12 15 6"/></svg>Cancel</button></div><div class="entry-card"><div class="entry-meta"><div style="display:flex;align-items:center;gap:10px"><span class="entry-date-badge mono">${entry.entry_date}</span><input type="date" id="edit-date-inp" value="${entry.entry_date}" max="${todayStr()}" style="background:var(--surface-2);border:1px solid var(--border);color:var(--text-bright);padding:3px 8px;border-radius:4px;font-family:var(--font-m);font-size:10px;outline:none" onchange="changeEntryDate(this.value)"/></div><span class="autosave-badge" id="autosave-badge">Saved ✓</span></div><textarea id="entry-title" class="title-input" rows="1" placeholder="Title…" oninput="autoGrow(this);scheduleEditSave()">${esc(entry.title)}</textarea><textarea id="entry-content" class="content-textarea" placeholder="Write…" oninput="autoGrow(this);scheduleEditSave()">${esc(entry.content)}</textarea><div class="entry-images-section"><div class="images-toolbar"><label class="img-upload-label" for="edit-img-inp"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>Add Photos</label><input type="file" id="edit-img-inp" accept="image/*" multiple style="display:none" onchange="handleEditImageUpload(this)"/><span class="img-count" id="edit-img-count">${entry.images.length>0?entry.images.length+' photo'+(entry.images.length>1?'s':''):''}</span></div><div class="images-grid" id="edit-images-grid">${renderEditImageThumbs(entry.images)}</div></div><div class="entry-footer"><button class="btn-primary btn-sm" onclick="saveEditEntry()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13"/><polyline points="7 3 7 8 15 8"/></svg>Save Changes</button></div></div>`; setTimeout(()=>{autoGrow(document.getElementById('entry-title'));autoGrow(document.getElementById('entry-content'));},0); }
function changeEntryDate(d){ if(!viewEntryId||!d) return; const ex=getEntryByDate(d); if(ex&&ex.id!==viewEntryId){showToast('Entry for that date already exists');return;} updateEntry(viewEntryId,{entry_date:d}); showToast('Date changed to '+d); }
function scheduleEditSave(){ clearTimeout(_editAutoTimer); _editAutoTimer=setTimeout(saveEditEntry,1200); }
function saveEditEntry(){ if(!viewEntryId) return; updateEntry(viewEntryId,{title:(document.getElementById('entry-title')?.value||'').trim(),content:document.getElementById('entry-content')?.value||''}); const b=document.getElementById('autosave-badge'); if(b){b.classList.add('show');setTimeout(()=>b.classList.remove('show'),2000);} }
async function handleEditImageUpload(input){ if(!input.files?.length||!viewEntryId) return; const entry=getEntry(viewEntryId); if(!entry) return; const imgs=[...entry.images]; for(const f of input.files){if(!f.type.startsWith('image/'))continue;imgs.push({id:uid(),data:await resizeImage(f),name:f.name});} updateEntry(viewEntryId,{images:imgs}); document.getElementById('edit-images-grid').innerHTML=renderEditImageThumbs(imgs); document.getElementById('edit-img-count').textContent=imgs.length+' photo'+(imgs.length!==1?'s':''); input.value=''; }
function removeEditImage(imgId){ if(!viewEntryId) return; const entry=getEntry(viewEntryId); if(!entry) return; const images=entry.images.filter(i=>i.id!==imgId); updateEntry(viewEntryId,{images}); document.getElementById('edit-images-grid').innerHTML=renderEditImageThumbs(images); document.getElementById('edit-img-count').textContent=images.length?images.length+' photo'+(images.length!==1?'s':''):''; }
function renderEditImageThumbs(images){ return images.map(img=>`<div class="img-thumb-wrap" onclick="openLightbox('${esc(img.data)}')"><img src="${img.data}" alt="${esc(img.name)}" loading="lazy"/><button class="img-remove-btn" onclick="event.stopPropagation();removeEditImage('${esc(img.id)}')">×</button></div>`).join(''); }

/* ════════════════════════════════════════
   MONEY TAB — income + expenses + loss
════════════════════════════════════════ */
const DEFAULT_SOURCES=[{id:'s1',name:'Freelance',color:'c',icon:'💻',active:true},{id:'s2',name:'Salary',color:'g',icon:'🏢',active:true}];
const MONEY_TYPES=[
  {id:'income', label:'Income',   color:'#10B981', bg:'rgba(16,185,129,0.08)', border:'rgba(16,185,129,0.2)'},
  {id:'expense',label:'Expense',  color:'#EF4444', bg:'rgba(239,68,68,0.08)',  border:'rgba(239,68,68,0.2)'},
  {id:'loss',   label:'Loss',     color:'#F59E0B', bg:'rgba(245,158,11,0.08)', border:'rgba(245,158,11,0.2)'},
];
function getMoneySources(){ return lsGet(LS_MONEY,DEFAULT_SOURCES); }
function saveMoneySources(s){ lsSet(LS_MONEY,s); }
function getMoneyLogs(){ return lsGet(LS_MONEY_LOG,[]); }
function saveMoneyLogs(l){ lsSet(LS_MONEY_LOG,l); }
function getActiveSources(){ return getMoneySources().filter(s=>s.active); }

function renderMoney(){
  const el=document.getElementById('page-money');
  const logs=getMoneyLogs(), today=todayStr(), thisMonth=today.slice(0,7);
  const allSources=getMoneySources(), srcMap={};
  allSources.forEach(s=>srcMap[s.id]=s);

  const sum=(filter)=>logs.filter(filter).reduce((s,l)=>s+Number(l.amount),0);
  const todayIncome=sum(l=>l.date===today&&l.type==='income');
  const todayExpense=sum(l=>l.date===today&&(l.type==='expense'||l.type==='loss'));
  const monthIncome=sum(l=>l.date.startsWith(thisMonth)&&l.type==='income');
  const monthExpense=sum(l=>l.date.startsWith(thisMonth)&&(l.type==='expense'||l.type==='loss'));
  const allIncome=sum(l=>l.type==='income');
  const allExpense=sum(l=>l.type==='expense'||l.type==='loss');
  const net=allIncome-allExpense;

  // by source income this month
  const bySource={};
  logs.filter(l=>l.date.startsWith(thisMonth)&&l.type==='income').forEach(l=>{ bySource[l.sourceId]=(bySource[l.sourceId]||0)+Number(l.amount); });
  const maxSrc=Math.max(...Object.values(bySource),1);

  // monthly totals for chart
  const byMonth={};
  logs.forEach(l=>{ const m=l.date.slice(0,7); if(!byMonth[m]) byMonth[m]={income:0,expense:0}; if(l.type==='income') byMonth[m].income+=Number(l.amount); else byMonth[m].expense+=Number(l.amount); });
  const months=Object.keys(byMonth).sort((a,b)=>b.localeCompare(a)).slice(0,6).reverse();
  const maxBar=Math.max(...months.map(m=>byMonth[m].income),1);

  el.innerHTML=`
  <div class="page-header">
    <div><h1 class="page-title">Money</h1><div class="page-subtitle">Income · Expenses · Loss</div></div>
    <button class="btn-primary btn-sm" onclick="openAddMoneyModal()">
      <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>Log Entry
    </button>
  </div>

  <div class="money-stats-row" style="grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:10px">
    <div class="money-stat-card"><div class="msc-label">Today Income</div><div class="msc-val green">${inrFmt(todayIncome)}</div></div>
    <div class="money-stat-card"><div class="msc-label">Today Spent</div><div class="msc-val" style="color:var(--red)">${inrFmt(todayExpense)}</div></div>
  </div>
  <div class="money-stats-row" style="grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:18px">
    <div class="money-stat-card"><div class="msc-label">${fmtMonth(today)} Income</div><div class="msc-val green">${inrFmt(monthIncome)}</div></div>
    <div class="money-stat-card"><div class="msc-label">${fmtMonth(today)} Spent</div><div class="msc-val" style="color:var(--red)">${inrFmt(monthExpense)}</div></div>
    <div class="money-stat-card"><div class="msc-label">Net Balance</div><div class="msc-val ${net>=0?'cyan':''}" style="${net<0?'color:var(--red)':''}">${inrFmt(net)}</div></div>
  </div>

  <div class="money-grid">
    <div class="money-left">
      <div class="card">
        <div class="card-header">
          <div class="card-title"><span class="cdot-cyan"></span>Income Sources — ${fmtMonth(today)}</div>
          <button class="card-action" onclick="openSourcesModal()">Manage</button>
        </div>
        ${getActiveSources().map(s=>{ const amt=bySource[s.id]||0; const pct=Math.round(amt/Math.max(monthIncome,1)*100); return `<div class="money-source-row"><span class="money-src-icon">${s.icon}</span><div style="flex:1"><div style="display:flex;justify-content:space-between;margin-bottom:4px"><span style="font-family:var(--font-d);font-size:12px;font-weight:700;color:var(--text-bright)">${esc(s.name)}</span><span style="font-family:var(--font-m);font-size:11px;color:var(--cyan)">${inrFmt(amt)} <span style="color:var(--muted-2)">(${pct}%)</span></span></div><div class="prog-track"><div class="prog-fill pf-c" style="width:${Math.round(amt/maxSrc*100)}%"></div></div></div></div>`; }).join('')||`<div style="font-size:11px;color:var(--muted-2);text-align:center;padding:12px;font-family:var(--font-m)">No sources — add via Manage</div>`}
      </div>
      <div class="card">
        <div class="card-header"><div class="card-title"><span class="cdot-green"></span>Monthly Chart</div></div>
        <div class="money-bar-chart" style="height:110px">
          ${months.map(m=>{ const inc=byMonth[m].income, exp=byMonth[m].expense, incH=Math.round(inc/maxBar*80); return `<div class="mbc-col"><div class="mbc-val">${inc>=1000?(inc/1000).toFixed(1)+'k':inc}</div><div class="mbc-bar-wrap" style="position:relative"><div class="mbc-bar${m===thisMonth?' active':''}" style="height:${incH}px"></div>${exp>0?`<div style="position:absolute;bottom:0;left:0;right:0;height:${Math.round(exp/maxBar*80)}px;background:rgba(239,68,68,0.4);border-radius:3px 3px 0 0"></div>`:''}</div><div class="mbc-label">${new Date(m+'-01').toLocaleDateString('en-IN',{month:'short'})}</div></div>`; }).join('')}
        </div>
        <div style="display:flex;gap:12px;margin-top:8px"><div style="display:flex;align-items:center;gap:5px;font-size:10px;color:var(--muted-1)"><span style="width:8px;height:8px;background:var(--cyan);border-radius:2px;display:inline-block"></span>Income</div><div style="display:flex;align-items:center;gap:5px;font-size:10px;color:var(--muted-1)"><span style="width:8px;height:8px;background:rgba(239,68,68,0.5);border-radius:2px;display:inline-block"></span>Expense/Loss</div></div>
      </div>
    </div>
    <div class="money-right">
      <div class="card">
        <div class="card-header"><div class="card-title"><span class="cdot-amber"></span>Recent Entries</div></div>
        ${logs.length===0?`<div style="font-size:11px;color:var(--muted-2);text-align:center;padding:16px;font-family:var(--font-m)">No entries yet</div>`:''}
        ${logs.slice().sort((a,b)=>b.date.localeCompare(a.date)).slice(0,20).map(l=>{ const src=srcMap[l.sourceId]; const mt=MONEY_TYPES.find(t=>t.id===l.type)||MONEY_TYPES[0]; return `<div class="money-log-item"><div style="display:flex;align-items:center;gap:7px;flex:1"><span style="font-size:15px">${src?.icon||'💰'}</span><div><div style="font-size:12px;font-weight:600;color:var(--text-bright);font-family:var(--font-d)">${esc(src?.name||l.sourceId)}</div>${l.note?`<div style="font-size:10px;color:var(--muted-1)">${esc(l.note)}</div>`:''}<div style="font-size:9px;color:var(--muted-2);font-family:var(--font-m)">${l.date}</div></div></div><div style="display:flex;align-items:center;gap:6px"><span style="font-family:var(--font-m);font-size:12px;color:${mt.color};font-weight:500">${l.type==='income'?'+':'−'}${inrFmt(l.amount)}</span><span style="font-size:9px;padding:1px 5px;border-radius:3px;font-family:var(--font-d);font-weight:700;background:${mt.bg};color:${mt.color};border:1px solid ${mt.border}">${mt.label}</span><button onclick="deleteMoneyLog('${l.id}')" style="background:none;border:none;color:var(--muted-2);cursor:pointer;font-size:14px;padding:2px 4px">×</button></div></div>`; }).join('')}
      </div>
    </div>
  </div>`;
}

function openAddMoneyModal(){
  const sources=getActiveSources();
  openModal('Log Money Entry',`
    <div style="display:flex;flex-direction:column;gap:10px">
      <div><label style="font-size:11px;color:var(--muted-1);font-family:var(--font-d);letter-spacing:0.06em;text-transform:uppercase;display:block;margin-bottom:6px">Type</label>
        <div style="display:flex;gap:6px">
          ${MONEY_TYPES.map(t=>`<button class="tag-opt" style="background:${t.bg};color:${t.color};border-color:${t.border}" onclick="selectMoneyType('${t.id}',this)" id="mtype-${t.id}">${t.label}</button>`).join('')}
        </div>
      </div>
      <div><label style="font-size:11px;color:var(--muted-1);font-family:var(--font-d);letter-spacing:0.06em;text-transform:uppercase;display:block;margin-bottom:4px">Source / Category</label>
        <select id="inc-src" style="width:100%;padding:7px 10px;border-radius:4px;border:1px solid var(--border);background:var(--surface-2);color:var(--text-bright);font-family:var(--font-b);outline:none">
          ${sources.map(s=>`<option value="${s.id}">${s.icon} ${s.name}</option>`).join('')}
        </select>
      </div>
      <div><label style="font-size:11px;color:var(--muted-1);font-family:var(--font-d);letter-spacing:0.06em;text-transform:uppercase;display:block;margin-bottom:4px">Amount (₹)</label>
        <input type="number" id="inc-amount" class="todo-text-inp" placeholder="0" min="0" style="margin-bottom:0"/></div>
      <div><label style="font-size:11px;color:var(--muted-1);font-family:var(--font-d);letter-spacing:0.06em;text-transform:uppercase;display:block;margin-bottom:4px">Date</label>
        <input type="date" id="inc-date" class="todo-text-inp" value="${todayStr()}" max="${todayStr()}" style="margin-bottom:0"/></div>
      <div><label style="font-size:11px;color:var(--muted-1);font-family:var(--font-d);letter-spacing:0.06em;text-transform:uppercase;display:block;margin-bottom:4px">Note (optional)</label>
        <input type="text" id="inc-note" class="todo-text-inp" placeholder="Description…" style="margin-bottom:0"/></div>
    </div>`,
    [{label:'Save',cls:'btn-primary',key:'save'},{label:'Cancel',cls:'btn-secondary',key:'cancel'}]);
  setTimeout(()=>document.getElementById('mtype-income')?.classList.add('selected'),50);
  _mActs.save=()=>{
    const type=document.querySelector('.modal .tag-opt.selected')?.id?.replace('mtype-','')||'income';
    const srcId=document.getElementById('inc-src')?.value;
    const amount=Number(document.getElementById('inc-amount')?.value||0);
    const date=document.getElementById('inc-date')?.value||todayStr();
    const note=(document.getElementById('inc-note')?.value||'').trim();
    if(!amount||amount<=0){showToast('Enter a valid amount');return;}
    const logs=getMoneyLogs(); logs.push({id:uid(),type,sourceId:srcId,amount,date,note,created:new Date().toISOString()});
    saveMoneyLogs(logs); closeModal(); renderMoney(); showToast('Entry logged!');
  };
  _mActs.cancel=closeModal;
}
let _moneyType='income';
function selectMoneyType(type,btn){ _moneyType=type; document.querySelectorAll('.modal .tag-opt').forEach(b=>b.classList.remove('selected')); btn.classList.add('selected'); }
function deleteMoneyLog(id){ saveMoneyLogs(getMoneyLogs().filter(l=>l.id!==id)); renderMoney(); }
function openSourcesModal(){ renderSourcesModal(); document.getElementById('sources-modal').classList.remove('hidden'); }
function closeSourcesModal(e){ if(e&&e.target!==document.getElementById('sources-modal')) return; document.getElementById('sources-modal').classList.add('hidden'); renderMoney(); }
function renderSourcesModal(){ document.getElementById('sources-modal-list').innerHTML=getMoneySources().map(s=>`<div class="hobby-modal-item"><span class="hobby-modal-emoji">${s.icon}</span><span class="hobby-modal-name">${esc(s.name)}${!s.active?'<span style="color:var(--muted-2);font-size:10px"> (removed)</span>':''}</span>${s.active?`<button class="hobby-modal-del" onclick="removeSource('${s.id}')">Remove</button>`:`<button class="hobby-modal-del" style="color:var(--green);border-color:rgba(16,185,129,0.25)" onclick="restoreSource('${s.id}')">Restore</button>`}</div>`).join(''); }
function removeSource(id){ const s=getMoneySources(), x=s.find(i=>i.id===id); if(x) x.active=false; saveMoneySources(s); renderSourcesModal(); }
function restoreSource(id){ const s=getMoneySources(), x=s.find(i=>i.id===id); if(x) x.active=true; saveMoneySources(s); renderSourcesModal(); }
function addMoneySource(){ const emoji=(document.getElementById('src-emoji-inp')?.value.trim())||'💰', name=(document.getElementById('src-name-inp')?.value.trim())||''; if(!name) return; const s=getMoneySources(); s.push({id:uid(),name,icon:emoji,active:true}); saveMoneySources(s); document.getElementById('src-emoji-inp').value=''; document.getElementById('src-name-inp').value=''; renderSourcesModal(); }

/* ════════════════════════════════════════
   FITNESS TAB — with details (distance/time/reps)
════════════════════════════════════════ */
const DEFAULT_FITNESS=[
  {id:'f1',emoji:'🌅',name:'Morning Wake-up',color:'a',active:true,unit:'time',unitLabel:'Wake time'},
  {id:'f2',emoji:'🏃',name:'Running',color:'g',active:true,unit:'km',unitLabel:'Distance (km)'},
  {id:'f3',emoji:'🏋️',name:'Gym',color:'c',active:true,unit:'mins',unitLabel:'Duration (mins)'},
  {id:'f4',emoji:'🧘',name:'Meditation',color:'p',active:true,unit:'mins',unitLabel:'Duration (mins)'},
];
function getFitnessItems(){ return lsGet(LS_FITNESS,DEFAULT_FITNESS); }
function saveFitnessItems(f){ lsSet(LS_FITNESS,f); }
function getActiveFitness(){ return getFitnessItems().filter(f=>f.active); }
function getFitLog(date){ return lsGet(LS_FIT_LOG+':'+date,{}); }
function saveFitLog(date,log){ lsSet(LS_FIT_LOG+':'+date,log); }
function calcFitStreak(fid){ let s=0; const d=new Date(); while(s<365){ const ds=d.toISOString().slice(0,10); if(!getFitLog(ds)[fid]) break; s++; d.setDate(d.getDate()-1); } return s; }

function renderFitness(){
  const el=document.getElementById('page-fitness');
  const items=getActiveFitness(), today=todayStr(), log=getFitLog(today);
  const done=items.filter(f=>log[f.id]).length, total=items.length;
  const weekDays=[]; for(let i=6;i>=0;i--){ const d=new Date(); d.setDate(d.getDate()-i); weekDays.push(d.toISOString().slice(0,10)); }

  el.innerHTML=`
  <div class="page-header">
    <div><h1 class="page-title">Fitness</h1><div class="page-subtitle">${done}/${total} done today</div></div>
    <button class="card-action" onclick="openFitnessManageModal()" style="font-family:var(--font-d);font-size:12px;font-weight:700;letter-spacing:0.07em;text-transform:uppercase;color:var(--cyan);background:var(--cyan-dim);border:1px solid rgba(0,212,255,0.2);border-radius:4px;padding:6px 12px;cursor:pointer">Manage</button>
  </div>
  <div class="card" style="margin-bottom:16px">
    <div class="card-header"><div class="card-title"><span class="cdot-green"></span>Today's Fitness</div>
    <span style="font-family:var(--font-m);font-size:12px;color:var(--green)">${total?Math.round(done/total*100):0}%</span></div>
    <div class="prog-track" style="height:8px"><div class="prog-fill pf-g" style="width:${total?Math.round(done/total*100):0}%;height:100%"></div></div>
    <div style="font-size:10px;color:var(--muted-2);font-family:var(--font-m);margin-top:6px">${done} of ${total} activities completed</div>
  </div>

  <div class="fitness-grid" id="fitness-grid">
    ${items.map(f=>{
      const streak=calcFitStreak(f.id), entry=log[f.id], isLogged=!!entry;
      const val=entry?.value, logTime=entry?.time||'';
      const dispVal=val?(f.unit==='km'?val+'km':f.unit==='mins'?val+'m':val):'';
      return `<div class="fitness-card fc-${f.color}${isLogged?' fc-done':''}">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
          <span style="font-size:24px">${f.emoji}</span>
          ${isLogged?`<span style="font-family:var(--font-m);font-size:9px;color:var(--green);background:var(--green-dim);padding:2px 6px;border-radius:3px;border:1px solid rgba(16,185,129,0.2)">✓ ${logTime}</span>`:''}
        </div>
        <div style="font-family:var(--font-d);font-size:14px;font-weight:700;color:var(--text-bright);margin-bottom:2px">${esc(f.name)}</div>
        ${isLogged&&dispVal?`<div style="font-family:var(--font-m);font-size:12px;color:var(--cyan);margin-bottom:3px">${dispVal}</div>`:''}
        <div style="font-size:10px;color:var(--muted-1);font-family:var(--font-m);margin-bottom:10px">${streak>0?'🔥 '+streak+' day streak':'Start streak today'}</div>
        <button class="fitness-log-btn${isLogged?' logged':''}" onclick="openFitnessLogModal('${f.id}')">
          ${isLogged?'✏️ Edit log':'Log today'}
        </button>
      </div>`;
    }).join('')}
  </div>

  <div class="card" style="margin-top:16px">
    <div class="card-header"><div class="card-title"><span class="cdot-cyan"></span>This Week</div></div>
    <div class="fit-week-table">
      <div class="fwt-header"><div class="fwt-name"></div>${weekDays.map(d=>`<div class="fwt-day">${new Date(d+'T00:00:00').toLocaleDateString('en-IN',{weekday:'short'}).slice(0,1)}<br><span style="font-size:8px">${new Date(d+'T00:00:00').getDate()}</span></div>`).join('')}</div>
      ${items.map(f=>`<div class="fwt-row"><div class="fwt-name">${f.emoji} ${esc(f.name)}</div>${weekDays.map(d=>{ const dl=getFitLog(d), isDone=!!dl[f.id], val=dl[f.id]?.value, isToday=d===today; return `<div class="fwt-cell${isDone?' fwt-done':''}${isToday?' fwt-today':''}" title="${isDone&&val?val+(f.unit==='km'?'km':f.unit==='mins'?'m':''):''}"></div>`; }).join('')}</div>`).join('')}
    </div>
  </div>`;
}

function openFitnessLogModal(fid){
  const items=getFitnessItems(), f=items.find(i=>i.id===fid); if(!f) return;
  const log=getFitLog(todayStr()), existing=log[fid];
  openModal(`Log — ${f.name}`,`
    <div style="display:flex;flex-direction:column;gap:12px">
      <div>
        <label style="font-size:11px;color:var(--muted-1);font-family:var(--font-d);letter-spacing:0.06em;text-transform:uppercase;display:block;margin-bottom:4px">${esc(f.unitLabel||'Value')}</label>
        <input type="${f.unit==='time'?'time':'number'}" id="fit-val" class="todo-text-inp" placeholder="${f.unit==='km'?'e.g. 5.2':f.unit==='mins'?'e.g. 30':'e.g. 06:30'}" value="${existing?.value||''}" min="0" step="${f.unit==='km'?'0.1':'1'}" style="margin-bottom:0"/>
      </div>
      <div>
        <label style="font-size:11px;color:var(--muted-1);font-family:var(--font-d);letter-spacing:0.06em;text-transform:uppercase;display:block;margin-bottom:4px">Notes (optional)</label>
        <input type="text" id="fit-note" class="todo-text-inp" placeholder="How did it go?" value="${existing?.note||''}" style="margin-bottom:0"/>
      </div>
    </div>`,
    [{label:'Save',cls:'btn-primary',key:'save'},{label:'Cancel',cls:'btn-secondary',key:'cancel'}]);
  _mActs.save=()=>{
    const val=document.getElementById('fit-val')?.value||'';
    const note=(document.getElementById('fit-note')?.value||'').trim();
    const log=getFitLog(todayStr());
    log[fid]={value:val,note,time:new Date().toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'})};
    saveFitLog(todayStr(),log); closeModal(); renderFitness(); showToast('Logged!');
  };
  _mActs.cancel=closeModal;
}
function logFitness(id,btn){ openFitnessLogModal(id); }
function openFitnessManageModal(){ renderFitnessModalList(); document.getElementById('fitness-modal').classList.remove('hidden'); }
function closeFitnessModal(e){ if(e&&e.target!==document.getElementById('fitness-modal')) return; document.getElementById('fitness-modal').classList.add('hidden'); renderFitness(); }
function renderFitnessModalList(){ document.getElementById('fitness-modal-list').innerHTML=getFitnessItems().map(f=>`<div class="hobby-modal-item"><span class="hobby-modal-emoji">${f.emoji}</span><span class="hobby-modal-name">${esc(f.name)}${!f.active?'<span style="color:var(--muted-2);font-size:10px"> (removed)</span>':''}</span>${f.active?`<button class="hobby-modal-del" onclick="removeFitnessItem('${f.id}')">Remove</button>`:`<button class="hobby-modal-del" style="color:var(--green);border-color:rgba(16,185,129,0.25)" onclick="restoreFitnessItem('${f.id}')">Restore</button>`}</div>`).join(''); }
function removeFitnessItem(id){ const items=getFitnessItems(), f=items.find(x=>x.id===id); if(f) f.active=false; saveFitnessItems(items); renderFitnessModalList(); }
function restoreFitnessItem(id){ const items=getFitnessItems(), f=items.find(x=>x.id===id); if(f) f.active=true; saveFitnessItems(items); renderFitnessModalList(); }
function addFitnessItem(){
  const emoji=(document.getElementById('fit-emoji-inp')?.value.trim())||'💪';
  const name=(document.getElementById('fit-name-inp')?.value.trim())||'';
  const unit=(document.getElementById('fit-unit-sel')?.value)||'mins';
  const unitLabel=unit==='km'?'Distance (km)':unit==='mins'?'Duration (mins)':unit==='time'?'Wake time':'Value';
  if(!name) return;
  const items=getFitnessItems(), colors=['c','g','p','a'], color=colors[items.filter(f=>f.active).length%4];
  items.push({id:uid(),emoji,name,color,active:true,unit,unitLabel});
  saveFitnessItems(items); document.getElementById('fit-emoji-inp').value=''; document.getElementById('fit-name-inp').value=''; renderFitnessModalList();
}

/* ════════════════════════════════════════
   TIME TAB
════════════════════════════════════════ */
const TIME_CATS=[
  {id:'waste',   label:'Time Wasted', color:'#EF4444', bg:'rgba(239,68,68,0.08)',   border:'rgba(239,68,68,0.2)'},
  {id:'utilized',label:'Utilized',    color:'#10B981', bg:'rgba(16,185,129,0.08)',  border:'rgba(16,185,129,0.2)'},
  {id:'normal',  label:'Normal Task', color:'#3B82F6', bg:'rgba(59,130,246,0.08)', border:'rgba(59,130,246,0.2)'},
];
function getTimeLogs(){ return lsGet(LS_TIME,[]); }
function saveTimeLogs(l){ lsSet(LS_TIME,l); }

function renderTime(){
  const el=document.getElementById('page-time');
  const logs=getTimeLogs(), today=todayStr();
  const todayLogs=logs.filter(l=>l.date===today);
  const todayMins={waste:0,utilized:0,normal:0};
  todayLogs.forEach(l=>{ todayMins[l.cat]=(todayMins[l.cat]||0)+Number(l.minutes); });
  const totalToday=Object.values(todayMins).reduce((a,b)=>a+b,0);
  const days7=[]; for(let i=6;i>=0;i--){ const d=new Date(); d.setDate(d.getDate()-i); days7.push(d.toISOString().slice(0,10)); }
  const chart7=days7.map(d=>{ const dl=logs.filter(l=>l.date===d); return {date:d,waste:dl.filter(l=>l.cat==='waste').reduce((s,l)=>s+Number(l.minutes),0),utilized:dl.filter(l=>l.cat==='utilized').reduce((s,l)=>s+Number(l.minutes),0),normal:dl.filter(l=>l.cat==='normal').reduce((s,l)=>s+Number(l.minutes),0)}; });
  const maxBar=Math.max(...chart7.map(d=>d.waste+d.utilized+d.normal),1);
  const allSorted=logs.slice().sort((a,b)=>b.date.localeCompare(a.date)||b.created.localeCompare(a.created));
  function minsToH(m){ return m>=60?Math.floor(m/60)+'h '+(m%60?m%60+'m':''):m+'m'; }

  el.innerHTML=`
  <div class="page-header">
    <div><h1 class="page-title">Time Tracker</h1><div class="page-subtitle">Red = wasted · Green = utilized · Blue = normal</div></div>
    <button class="btn-primary btn-sm" onclick="openAddTimeModal()">
      <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>Log Time
    </button>
  </div>
  <div class="time-summary-row">
    ${TIME_CATS.map(cat=>`<div class="time-summary-card" style="border-color:${cat.border};background:${cat.bg}"><div class="tsc-label" style="color:${cat.color}">${cat.label}</div><div class="tsc-val" style="color:${cat.color}">${minsToH(todayMins[cat.id]||0)}</div></div>`).join('')}
  </div>
  <div class="card" style="margin-bottom:16px;border-color:rgba(245,158,11,0.2)">
    <div style="display:flex;align-items:flex-start;gap:10px"><span style="font-size:18px;flex-shrink:0">📱</span><div>
      <div style="font-family:var(--font-d);font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:var(--amber);margin-bottom:4px">Screen Time Integration</div>
      <div style="font-size:12px;color:var(--muted-1);line-height:1.6">Check <b style="color:var(--text)">Settings → Digital Wellbeing</b> on your phone and log the numbers here manually. Native app required for auto-sync.</div>
      <button onclick="openAddTimeModal('waste')" class="btn-outline btn-sm" style="margin-top:8px;font-size:10px">Log screen time manually</button>
    </div></div>
  </div>
  ${totalToday>0?`<div class="card" style="margin-bottom:16px"><div class="card-header"><div class="card-title"><span class="cdot-cyan"></span>Today's Breakdown</div><span style="font-family:var(--font-m);font-size:10px;color:var(--muted-2)">${minsToH(totalToday)} total</span></div><div class="time-breakdown-bar">${TIME_CATS.filter(c=>todayMins[c.id]>0).map(c=>`<div class="tbb-seg" style="width:${Math.round(todayMins[c.id]/totalToday*100)}%;background:${c.color}" title="${c.label}: ${minsToH(todayMins[c.id])}"></div>`).join('')}</div><div class="time-breakdown-legend">${TIME_CATS.filter(c=>todayMins[c.id]>0).map(c=>`<div class="tbl-item"><span class="tbl-dot" style="background:${c.color}"></span><span>${c.label}: ${minsToH(todayMins[c.id])}</span></div>`).join('')}</div></div>`:''}
  <div class="card" style="margin-bottom:16px"><div class="card-header"><div class="card-title"><span class="cdot-cyan"></span>Last 7 Days</div></div>
    <div class="time-chart">${chart7.map(d=>{ const total=d.waste+d.utilized+d.normal, wH=total?Math.round(d.waste/maxBar*80):0, uH=total?Math.round(d.utilized/maxBar*80):0, nH=total?Math.round(d.normal/maxBar*80):0, isToday=d.date===today; return `<div class="tc-col"><div class="tc-bars">${d.normal?`<div class="tc-seg" style="height:${nH}px;background:#3B82F6"></div>`:''} ${d.utilized?`<div class="tc-seg" style="height:${uH}px;background:#10B981"></div>`:''} ${d.waste?`<div class="tc-seg" style="height:${wH}px;background:#EF4444"></div>`:''} ${!total?`<div style="height:4px;border-radius:2px;background:var(--surface-3);width:100%"></div>`:''}</div><div class="tc-label${isToday?' tc-today':''}">${new Date(d.date+'T00:00:00').toLocaleDateString('en-IN',{weekday:'short'}).slice(0,1)}</div></div>`; }).join('')}</div>
    <div style="display:flex;gap:12px;margin-top:8px">${TIME_CATS.map(c=>`<div style="display:flex;align-items:center;gap:5px;font-size:10px;color:var(--muted-1)"><span style="width:8px;height:8px;border-radius:2px;background:${c.color};display:inline-block"></span>${c.label}</div>`).join('')}</div>
  </div>
  <div class="card"><div class="card-header"><div class="card-title"><span class="cdot-purple"></span>All Entries</div></div>
    ${allSorted.length===0?`<div style="font-size:11px;color:var(--muted-2);text-align:center;padding:16px;font-family:var(--font-m)">No time entries yet</div>`:''}
    ${allSorted.slice(0,25).map(l=>{ const cat=TIME_CATS.find(c=>c.id===l.cat)||TIME_CATS[0]; return `<div class="money-log-item"><div style="display:flex;align-items:center;gap:8px;flex:1"><div class="tbl-dot" style="background:${cat.color};width:8px;height:8px;border-radius:50%;flex-shrink:0"></div><div><div style="font-size:12px;font-weight:600;color:var(--text-bright);font-family:var(--font-d)">${esc(l.label)}</div><div style="font-size:9px;color:var(--muted-2);font-family:var(--font-m)">${l.date}</div></div></div><div style="display:flex;align-items:center;gap:8px"><span style="font-family:var(--font-m);font-size:12px;color:${cat.color}">${minsToH(l.minutes)}</span><span style="font-size:9px;padding:1px 5px;border-radius:3px;font-family:var(--font-d);font-weight:700;background:${cat.bg};color:${cat.color};border:1px solid ${cat.border}">${cat.label}</span><button onclick="deleteTimeLog('${l.id}')" style="background:none;border:none;color:var(--muted-2);cursor:pointer;font-size:14px;padding:2px 4px">×</button></div></div>`; }).join('')}
  </div>`;
}

function openAddTimeModal(defaultCat){
  openModal('Log Time Block',`
    <div style="display:flex;flex-direction:column;gap:10px">
      <div><label style="font-size:11px;color:var(--muted-1);font-family:var(--font-d);letter-spacing:0.06em;text-transform:uppercase;display:block;margin-bottom:6px">Category</label>
        <div style="display:flex;gap:6px flex-wrap:wrap">${TIME_CATS.map(c=>`<button class="tag-opt${defaultCat===c.id?' selected':''}" style="background:${c.bg};color:${c.color};border-color:${c.border}" onclick="selectTimeCat('${c.id}',this)" id="tcat-${c.id}">${c.label}</button>`).join('')}</div></div>
      <div><label style="font-size:11px;color:var(--muted-1);font-family:var(--font-d);letter-spacing:0.06em;text-transform:uppercase;display:block;margin-bottom:4px">Activity / Label</label>
        <input type="text" id="time-label" class="todo-text-inp" placeholder="e.g. Instagram, Deep work, Commute" style="margin-bottom:0"/></div>
      <div><label style="font-size:11px;color:var(--muted-1);font-family:var(--font-d);letter-spacing:0.06em;text-transform:uppercase;display:block;margin-bottom:4px">Duration (minutes)</label>
        <input type="number" id="time-mins" class="todo-text-inp" placeholder="30" min="1" style="margin-bottom:0"/></div>
      <div><label style="font-size:11px;color:var(--muted-1);font-family:var(--font-d);letter-spacing:0.06em;text-transform:uppercase;display:block;margin-bottom:4px">Date</label>
        <input type="date" id="time-date" class="todo-text-inp" value="${todayStr()}" max="${todayStr()}" style="margin-bottom:0"/></div>
    </div>`,
    [{label:'Save',cls:'btn-primary',key:'save'},{label:'Cancel',cls:'btn-secondary',key:'cancel'}]);
  if(defaultCat) setTimeout(()=>document.getElementById('tcat-'+defaultCat)?.classList.add('selected'),50);
  _mActs.save=()=>{
    const selBtn=document.querySelector('.modal [id^="tcat-"].selected');
    const cat=selBtn?selBtn.id.replace('tcat-',''):'normal';
    const label=(document.getElementById('time-label')?.value||'').trim();
    const minutes=Number(document.getElementById('time-mins')?.value||0);
    const date=document.getElementById('time-date')?.value||todayStr();
    if(!label||!minutes||minutes<=0){showToast('Fill in all fields');return;}
    const logs=getTimeLogs(); logs.push({id:uid(),cat,label,minutes,date,created:new Date().toISOString()});
    saveTimeLogs(logs); closeModal(); renderTime(); showToast('Time logged!');
  };
  _mActs.cancel=closeModal;
}
function selectTimeCat(cat,btn){ document.querySelectorAll('.modal .tag-opt').forEach(b=>b.classList.remove('selected')); btn.classList.add('selected'); }
function deleteTimeLog(id){ saveTimeLogs(getTimeLogs().filter(l=>l.id!==id)); renderTime(); }

/* ── DELETE CONFIRM ── */
const _mActs={};
function confirmDelete(id){ openModal('Delete Entry','<p>Delete this entry permanently?</p>',[{label:'Delete',cls:'btn-danger',key:'del'},{label:'Cancel',cls:'btn-secondary',key:'cancel'}]); _mActs.del=()=>{deleteEntryById(id);closeModal();navTo('entries');showToast('Entry deleted');}; _mActs.cancel=closeModal; }

/* ── LIGHTBOX ── */
function openLightbox(src){ document.getElementById('lightbox-img').src=src; document.getElementById('lightbox').classList.remove('hidden'); }
function closeLightbox(){ document.getElementById('lightbox').classList.add('hidden'); }

/* ── MODAL ── */
function openModal(title,body,buttons=[]){ document.getElementById('modal-title').textContent=title; document.getElementById('modal-body').innerHTML=body; document.getElementById('modal-footer').innerHTML=buttons.map(b=>`<button class="${b.cls}" onclick="_mActs['${b.key}']()">${b.label}</button>`).join(''); document.getElementById('modal-backdrop').classList.remove('hidden'); }
function closeModal(e){ if(e&&e.target!==document.getElementById('modal-backdrop')) return; document.getElementById('modal-backdrop').classList.add('hidden'); }

/* ── TOAST ── */
let _tt;
function showToast(msg,ms=3000){ const t=document.getElementById('toast'); t.textContent=msg; t.classList.remove('hidden'); clearTimeout(_tt); _tt=setTimeout(()=>t.classList.add('hidden'),ms); }

/* ── CLOUD SYNC & AUTH ── */
async function init(){
  initSupabase();
  if('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(()=>{});
  if(sb){
    try{
      const {data:{session}}=await sb.auth.getSession();
      if(session?.user){ currentUser=session.user; await loadFromCloud(); }
      sb.auth.onAuthStateChange(async(_e,session)=>{ currentUser=session?.user||null; if(currentUser) await loadFromCloud(); renderRoute(); });
    }catch(e){}
  }
  renderRoute();
}
document.addEventListener('DOMContentLoaded', init);
