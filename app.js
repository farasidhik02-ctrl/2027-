(() => {
  const cfg = window.SCC_CONFIG || {};
  const sb = window.supabase && cfg.SUPABASE_URL && cfg.SUPABASE_KEY
    ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_KEY)
    : null;

  const $ = (id) => document.getElementById(id);
  const todayISO = () => { const d=new Date(); const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,'0'), day=String(d.getDate()).padStart(2,'0'); return `${y}-${m}-${day}`; };
  const PLAN_ENGINE_VERSION='priority-freeze-psc40-pubad-ethics-2026-09-01';
  const PSC_TARGET_DATE='2026-10-10', PSC_HARD_DATE='2026-10-14', UPSC_PRELIMS_DATE='2027-05-23';
  const addDays = (dateStr, days) => { const d = new Date(dateStr+'T12:00:00'); d.setDate(d.getDate()+days); return d.toISOString().slice(0,10); };
  const esc = (s='') => String(s).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const uuid = () => crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)+Date.now();

  const state = {
    user: null, offline: false, settings: {daily_minutes:240, minimum_goal:3, pomodoro_focus:25, pomodoro_break:5},
    exams: [], microtopics: [], tasks: [], reviews: [], errors: [], sessions: [], stats: {xp:0, streak:0, longest_streak:0, last_goal_date:null},
    timer: {taskId:null, mode:'countdown', total:1500, left:1500, running:false, interval:null, startedAt:null, startLeft:1500, accumulated:0},
    currentReview: null
  };

  function toast(msg){ const el=$('toast'); el.textContent=msg; el.classList.add('show'); setTimeout(()=>el.classList.remove('show'),2200); }
  function lsKey(name){ return `scc_${name}`; }
  function loadLocal(){
    ['settings','exams','microtopics','tasks','reviews','errors','sessions','stats'].forEach(k=>{ const v=localStorage.getItem(lsKey(k)); if(v) try{state[k]=JSON.parse(v)}catch{} });
  }
  function saveLocal(){ ['settings','exams','microtopics','tasks','reviews','errors','sessions','stats'].forEach(k=>localStorage.setItem(lsKey(k),JSON.stringify(state[k]))); }

  async function init(){
    $('dateLabel').textContent = new Intl.DateTimeFormat('en-IN',{weekday:'long',day:'numeric',month:'long'}).format(new Date());
    $('taskDate').value=todayISO();
    bindEvents();
    if(!sb){ enterOffline(); return; }
    const {data:{session}} = await sb.auth.getSession();
    if(session?.user){ state.user=session.user; await enterApp(); }
    else $('authView').classList.remove('hidden');
    sb.auth.onAuthStateChange(async (_event,session)=>{ if(session?.user && !state.user){state.user=session.user;await enterApp();} });
  }

  function bindEvents(){
    $('signInBtn').onclick=signIn; $('signUpBtn').onclick=signUp; $('offlineBtn').onclick=enterOffline; $('logoutBtn').onclick=logout;
    $('quickAddBtn').onclick=()=>$('taskDialog').showModal(); $('addErrorBtn').onclick=()=>$('errorDialog').showModal();
    $('saveTaskBtn').onclick=saveTaskFromForm; $('saveErrorBtn').onclick=saveErrorFromForm;
    $('replanBtn').onclick=replan;
    $('mainNav').addEventListener('click',e=>{const b=e.target.closest('.nav-item');if(b) switchView(b.dataset.view)});
    $('energyMode').onchange=e=>{$('dailyMinutesSetting').value=e.target.value;};
    $('timerStartBtn').onclick=startTimer; $('timerPauseBtn').onclick=()=>pauseTimer(true); $('timerResetBtn').onclick=resetTimer;
    $('timerMode').onchange=async e=>{state.timer.mode=e.target.value; if(e.target.value==='pomodoro') await setTimerMinutes(state.settings.pomodoro_focus); else if(e.target.value==='recall') await setTimerMinutes(10);};
    document.querySelectorAll('.timer-presets button').forEach(b=>b.onclick=async()=>await setTimerMinutes(+b.dataset.min));
    $('saveSettingsBtn').onclick=saveSettings;
    $('errorSearch').oninput=renderErrors; $('syllabusSearch').oninput=renderSubjects; $('syllabusExamFilter').onchange=renderSubjects; $('errorExamFilter').onchange=renderErrors;
    document.querySelectorAll('.rating').forEach(b=>b.onclick=()=>rateReview(b.dataset.rating));
  }

  async function signIn(){
    $('authMessage').textContent='Signing in…';
    const {error}=await sb.auth.signInWithPassword({email:$('authEmail').value.trim(),password:$('authPassword').value});
    $('authMessage').textContent=error?error.message:'';
  }
  async function signUp(){
    $('authMessage').textContent='Creating account…';
    const {data,error}=await sb.auth.signUp({email:$('authEmail').value.trim(),password:$('authPassword').value});
    $('authMessage').textContent=error?error.message:(data.session?'Account created.':'Check your email to confirm, then sign in.');
  }
  async function logout(){ if(!state.offline && sb) await sb.auth.signOut(); state.user=null; location.reload(); }
  function enterOffline(){ state.offline=true; loadLocal(); if(!state.exams.length) seedStarterLocal(); showApp(); }

  async function enterApp(){
    try{
      await loadRemote();
      if(!state.exams.length) await seedStarterRemote();
      await loadRemote();
      await ensureSyllabusImported();
      await loadRemote();
      await autoPlanForToday();
      showApp();
    }
    catch(err){ console.error(err); $('authMessage').textContent='Sync setup needs attention: '+(err?.message||err); state.user=null; $('authView').classList.remove('hidden'); }
  }
  function showApp(){ $('authView').classList.add('hidden'); $('app').classList.remove('hidden'); $('syncBadge').textContent=state.offline?'● Offline / local':'● Synced with Supabase'; hydrateSettings(); renderAll(); }

  async function fetchAll(table, queryBuilder){
    const pageSize=1000, out=[];
    for(let from=0;;from+=pageSize){
      let q=sb.from(table).select('*');
      if(queryBuilder) q=queryBuilder(q);
      const {data,error}=await q.range(from,from+pageSize-1);
      if(error) throw error;
      out.push(...(data||[]));
      if(!data || data.length<pageSize) break;
    }
    return out;
  }

  async function loadRemote(){
    const uid=state.user.id;
    const [settings,exams,microtopics,tasks,reviews,errors,sessions,stats]=await Promise.all([
      sb.from('scc_settings').select('*').eq('user_id',uid).maybeSingle(),
      fetchAll('scc_exams',q=>q.eq('user_id',uid).order('sort_order')),
      fetchAll('scc_microtopics',q=>q.eq('user_id',uid).order('source_order')),
      fetchAll('scc_tasks',q=>q.eq('user_id',uid).order('scheduled_date').order('sort_order')),
      fetchAll('scc_reviews',q=>q.eq('user_id',uid).order('due_date')),
      fetchAll('scc_errors',q=>q.eq('user_id',uid).order('created_at',{ascending:false})),
      fetchAll('scc_sessions',q=>q.eq('user_id',uid).order('ended_at',{ascending:false})),
      sb.from('scc_stats').select('*').eq('user_id',uid).maybeSingle()
    ]);
    const err=[settings,stats].find(x=>x.error)?.error; if(err) throw err;
    state.settings=settings.data||state.settings; state.exams=exams||[]; state.microtopics=microtopics||[]; state.tasks=tasks||[]; state.reviews=reviews||[]; state.errors=errors||[]; state.sessions=sessions||[]; state.stats=stats.data||state.stats;
  }

  async function ensureSyllabusImported(){
    const bank=window.SCC_SYLLABUS_DATA;
    if(!bank || !bank.exams) return;
    const expected=Object.values(bank.exams).reduce((n,a)=>n+a.length,0);
    const existingKeys=new Set(state.microtopics.map(m=>m.source_key).filter(Boolean));
    if(existingKeys.size>=expected) return;
    $('authMessage').textContent=`Loading complete syllabus bank… ${existingKeys.size}/${expected}`;
    const byShort=Object.fromEntries(state.exams.map(e=>[e.short_name,e]));
    const pending=[];
    for(const [short,items] of Object.entries(bank.exams)){
      const exam=byShort[short]; if(!exam) continue;
      for(const m of items){
        if(existingKeys.has(m.source_key)) continue;
        pending.push({
          user_id:state.user.id,exam_id:exam.id,subject:m.subject,topic:m.topic,microtopic:m.microtopic,
          status:'not_started',strength:'new',priority:m.priority||3,estimated_minutes:m.estimated_minutes||20,
          source_key:m.source_key,source_name:short==='PSC'?'Kerala PSC University Assistant Main Syllabus Cat.No. 454/2025':short==='PUB AD'?'Public Administration Optional Micro Listing 2026-27':'UPSC GS Micro Topics Listing 2026-27',
          source_order:m.source_order||0,paper:m.paper||null,concept_key:conceptKey(m.microtopic),
          is_leaf:m.is_leaf!==false,counts_toward_completion:m.counts!==false,recurring:!!m.recurring
        });
      }
    }
    for(let i=0;i<pending.length;i+=250){
      const {error}=await sb.from('scc_microtopics').upsert(pending.slice(i,i+250),{onConflict:'user_id,source_key',ignoreDuplicates:true});
      if(error) throw error;
      $('authMessage').textContent=`Loading complete syllabus bank… ${Math.min(existingKeys.size+i+250,expected)}/${expected}`;
    }
    $('authMessage').textContent='';
  }

  function conceptKey(text=''){
    return String(text).toLowerCase().replace(/\([^)]*\)/g,' ').replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ').slice(0,160);
  }

  function starterData(){
    const t=todayISO();
    const examDefs=[
      {name:'Kerala PSC University Assistant',short_name:'PSC',deadline:'2026-10-14',color:'#31d47d',sort_order:1},
      {name:'UPSC CSE General Studies',short_name:'UPSC GS',deadline:'2027-05-23',color:'#39a8ff',sort_order:2},
      {name:'Public Administration Optional',short_name:'PUB AD',deadline:null,color:'#9c7cff',sort_order:3}
    ];
    const taskDefs=[
      {title:'Economics: sectors + GDP/GNP/NNP + per capita income',subject:'Economics',topic:'Indian Economy basics',task_type:'study',estimated_minutes:45,priority:5,sort_order:1,exam:'PSC'},
      {title:'Five Year Plans I–VII: years, objectives, Plan Holiday, Rolling Plan',subject:'Economics',topic:'Five Year Plans I–VII',task_type:'study',estimated_minutes:45,priority:5,sort_order:2,exam:'PSC'},
      {title:'Planning MCQs: solve 25 questions',subject:'Economics',topic:'Planning and Five Year Plans',task_type:'mcq',estimated_minutes:35,priority:4,sort_order:3,exam:'PSC'},
      {title:'Current Affairs: important events, schemes, reports, appointments',subject:'Current Affairs',topic:'Daily Current Affairs',task_type:'current_affairs',estimated_minutes:40,priority:5,sort_order:4,exam:'PSC'},
      {title:'Pub Ad: Meaning of administration + meaning of Public Administration',subject:'Public Administration',topic:'Introduction: Foundations',task_type:'study',estimated_minutes:30,priority:3,sort_order:5,exam:'PUB AD'},
      {title:'Pub Ad: Narrow view + Broad view + POSDCORB view',subject:'Public Administration',topic:'Introduction: Nature and Scope',task_type:'study',estimated_minutes:30,priority:3,sort_order:6,exam:'PUB AD'}
    ];
    return {t,examDefs,taskDefs};
  }

  function seedStarterLocal(){
    const {t,examDefs,taskDefs}=starterData();
    state.exams=examDefs.map(e=>({...e,id:uuid(),user_id:'offline'}));
    const byShort=Object.fromEntries(state.exams.map(e=>[e.short_name,e]));
    state.tasks=taskDefs.map(d=>({...d,id:uuid(),user_id:'offline',exam_id:byShort[d.exam]?.id,scheduled_date:t,source:'planner',completed:false,actual_minutes:0,xp_awarded:0}));
    state.settings={daily_minutes:240,minimum_goal:3,pomodoro_focus:25,pomodoro_break:5}; state.stats={xp:0,streak:0,longest_streak:0,last_goal_date:null}; saveLocal();
  }

  async function seedStarterRemote(){
    const uid=state.user.id; const {t,examDefs,taskDefs}=starterData();
    await sb.from('scc_settings').upsert({user_id:uid,daily_minutes:240,minimum_goal:3,pomodoro_focus:25,pomodoro_break:5});
    await sb.from('scc_stats').upsert({user_id:uid,xp:0,streak:0,longest_streak:0});
    const {data:exams,error}=await sb.from('scc_exams').insert(examDefs.map(e=>({...e,user_id:uid}))).select(); if(error) throw error;
    const byShort=Object.fromEntries(exams.map(e=>[e.short_name,e]));
    const rows=taskDefs.map(({exam,...d})=>({...d,user_id:uid,exam_id:byShort[exam]?.id,scheduled_date:t,source:'planner'}));
    const {error:te}=await sb.from('scc_tasks').insert(rows); if(te) throw te;
  }

  function hydrateSettings(){
    $('dailyMinutesSetting').value=state.settings.daily_minutes||240; $('minimumGoalSetting').value=state.settings.minimum_goal||3; $('pomodoroFocusSetting').value=state.settings.pomodoro_focus||25; $('pomodoroBreakSetting').value=state.settings.pomodoro_break||5; $('goalTarget').textContent=state.settings.minimum_goal||3;
    const map=[180,240,360]; $('energyMode').value=map.includes(+state.settings.daily_minutes)?String(state.settings.daily_minutes):'240';
  }

  function deadlineFor(short){return short==='PSC'?PSC_HARD_DATE:short==='UPSC GS'?UPSC_PRELIMS_DATE:null;}
  function daysUntil(dateStr){const a=new Date(todayISO()+'T12:00:00'),b=new Date(dateStr+'T12:00:00');return Math.max(0,Math.ceil((b-a)/86400000));}
  function updateDeadlineUI(){if($('pscDaysLeft'))$('pscDaysLeft').textContent=daysUntil(PSC_HARD_DATE);if($('upscDaysLeft'))$('upscDaysLeft').textContent=daysUntil(UPSC_PRELIMS_DATE);}
  function renderAll(){ fillExamSelects(); updateStudyTimeUI(); updateDeadlineUI(); updatePaceBanner(); renderToday(); renderRecall(); renderCarry(); renderPlan(); renderSubjects(); renderRevision(); renderErrors(); renderProgress(); renderRewards(); updateStatsUI(); }
  function fillExamSelects(){
    const opts='<option value="">No exam</option>'+state.exams.map(e=>`<option value="${e.id}">${esc(e.short_name)} · ${esc(e.name)}</option>`).join(''); $('taskExam').innerHTML=opts;
    const nameOpts=state.exams.map(e=>`<option value="${esc(e.short_name)}">${esc(e.short_name)} · ${esc(e.name)}</option>`).join(''); $('errorExam').innerHTML=nameOpts; $('errorExamFilter').innerHTML='<option value="">All exams</option>'+nameOpts;
  }
  function examShort(id){ return state.exams.find(e=>e.id===id)?.short_name||''; }

  function renderToday(){
    const today=todayISO();
    const dueReviews=state.reviews.filter(r=>!r.completed&&r.due_date<=today).sort((a,b)=>(a.exam==='PSC'?0:1)-(b.exam==='PSC'?0:1)||a.due_date.localeCompare(b.due_date));
    const tasks=state.tasks.filter(t=>t.scheduled_date===today).sort((a,b)=>(a.sort_order||0)-(b.sort_order||0));
    $('emptyTasks').classList.toggle('hidden',tasks.length>0||dueReviews.length>0);
    const reviewHtml=dueReviews.map((r,i)=>`<article class="task-card ${i===0?'next-task':''}" data-review-id="${r.id}">
      <div class="task-number">${i+1}</div><div><div class="task-title">Recall: ${esc(r.title)}</div><div class="task-sub">${esc(r.subject||'')} › spaced revision due ${esc(r.due_date)}</div><div class="task-meta"><span class="tag">${esc(r.exam||'REVIEW')}</span><span class="tag">recall</span> ⏱ 10 min</div></div>
      <div class="task-actions"><button class="btn ghost review-start" data-action="review">▶ Recall</button></div></article>`).join('');
    const offset=dueReviews.length;
    const nextTask=dueReviews.length?null:tasks.find(t=>!t.completed)?.id;
    const taskHtml=tasks.map((t,i)=>`<article class="task-card ${t.completed?'completed':''} ${t.id===nextTask?'next-task':''}" data-task-id="${t.id}">
      <div class="task-number">${t.completed?'✓':i+1+offset}</div><div><div class="task-title">${esc(t.title)}</div><div class="task-sub">${esc(t.subject||'')} ${t.topic?'› '+esc(t.topic):''}</div><div class="task-meta"><span class="tag">${esc(examShort(t.exam_id)||'MANUAL')}</span><span class="tag">${esc(t.task_type)}</span> ⏱ Plan ${t.estimated_minutes} min${(t.actual_minutes||0)>0?` · <b class="actual-time">Studied ${t.actual_minutes} min</b>`:''}</div></div>
      <div class="task-actions"><button class="btn ghost task-start" data-action="start">▶ Timer</button><input aria-label="Complete task" type="checkbox" data-action="complete" ${t.completed?'checked':''}></div></article>`).join('');
    $('taskList').innerHTML=reviewHtml+taskHtml;
    $('taskList').querySelectorAll('[data-action="review"]').forEach(b=>b.onclick=()=>startReview(b.closest('[data-review-id]').dataset.reviewId));
    $('taskList').querySelectorAll('[data-action="start"]').forEach(b=>b.onclick=()=>selectTaskTimer(b.closest('.task-card').dataset.taskId));
    $('taskList').querySelectorAll('[data-action="complete"]').forEach(c=>c.onchange=()=>toggleTask(c.closest('.task-card').dataset.taskId,c.checked));
    const done=tasks.filter(t=>t.completed).length, goal=state.settings.minimum_goal||3; $('goalDone').textContent=done; $('goalBar').style.width=`${Math.min(100,done/goal*100)}%`;
  }

  async function toggleTask(id,completed){
    const t=state.tasks.find(x=>x.id===id); if(!t) return; const was=t.completed; t.completed=completed; t.completed_at=completed?new Date().toISOString():null;
    if(completed && !was){ const xp=20+Math.floor((t.actual_minutes||0)/5); t.xp_awarded=xp; state.stats.xp=(state.stats.xp||0)+xp; if(t.microtopic_id && t.task_type==='study') await createFirstReviewForTask(t); }
    if(!completed && was){ state.stats.xp=Math.max(0,(state.stats.xp||0)-(t.xp_awarded||0)); t.xp_awarded=0; }
    await persistTask(t);
    if(t.microtopic_id){
      const m=state.microtopics.find(x=>x.id===t.microtopic_id);
      if(m){m.status=completed?'studied':'not_started';m.strength=completed?'studied':'new';m.last_studied_at=completed?new Date().toISOString():null;await persistMicrotopic(m);}
    }
    await persistStats(); await updateStreakIfGoalMet(); renderAll();
  }

  async function createFirstReviewForTask(t){
    if(state.reviews.some(r=>r.task_id===t.id)) return;
    const r={id:uuid(),user_id:state.offline?'offline':state.user.id,microtopic_id:t.microtopic_id||null,task_id:t.id,title:t.title,subject:t.subject||'',exam:examShort(t.exam_id),stage:0,due_date:addDays(todayISO(),1),completed:false,rating:null}; state.reviews.push(r); await persistInsert('scc_reviews',r);
  }

  async function updateStreakIfGoalMet(){
    const day=todayISO(), done=state.tasks.filter(t=>t.scheduled_date===day&&t.completed).length, goal=state.settings.minimum_goal||3; if(done<goal||state.stats.last_goal_date===day)return;
    const yesterday=addDays(day,-1); state.stats.streak=state.stats.last_goal_date===yesterday?(state.stats.streak||0)+1:1; state.stats.longest_streak=Math.max(state.stats.longest_streak||0,state.stats.streak); state.stats.last_goal_date=day; state.stats.xp=(state.stats.xp||0)+20; await persistStats(); toast('Minimum goal hit. Streak protected 🔥');
  }

  function renderPlan(){
    const today=todayISO();
    const rows=state.tasks.filter(t=>t.scheduled_date>=today).sort((a,b)=>a.scheduled_date.localeCompare(b.scheduled_date)||(a.sort_order||0)-(b.sort_order||0));
    const el=$('planList');
    if(!el) return;
    el.innerHTML=rows.length?rows.slice(0,60).map(t=>`<div class="stack-item"><div><strong>${esc(t.title)}</strong><small>${esc(t.subject||'')} ${t.topic?'· '+esc(t.topic):''} · ${esc(examShort(t.exam_id)||'MANUAL')}</small></div><div>${esc(t.scheduled_date)} · ${t.estimated_minutes||0}m${t.completed?' · ✓':''}</div></div>`).join(''):'<div class="empty-state">No upcoming tasks yet.</div>';
  }

  function renderCarry(){
    const today=todayISO(), items=state.tasks.filter(t=>!t.completed&&t.scheduled_date<today).sort((a,b)=>b.priority-a.priority); $('carryCount').textContent=items.length; $('carryList').innerHTML=items.length?items.slice(0,5).map(t=>`<div class="mini-item"><strong>${esc(t.title)}</strong><small>${esc(t.subject||'')} · due ${esc(t.scheduled_date)}</small></div>`).join(''):'<div class="mini-item muted">No carry-over. Nice.</div>';
  }

  function renderRecall(){
    const today=todayISO(), items=state.reviews.filter(r=>!r.completed&&r.due_date<=today); $('recallCount').textContent=`${items.length} due`; $('recallList').innerHTML=items.length?items.slice(0,4).map(r=>`<div class="mini-item"><strong>${esc(r.title)}</strong><small>${esc(r.subject||'')} · Review ${r.stage+1}</small><div style="margin-top:8px"><button class="btn ghost" data-review="${r.id}">Start 10m recall</button></div></div>`).join(''):'<div class="mini-item muted">Nothing due today.</div>';
    $('recallList').querySelectorAll('[data-review]').forEach(b=>b.onclick=()=>startReview(b.dataset.review));
  }

  function startReview(id){ state.currentReview=state.reviews.find(r=>r.id===id); if(!state.currentReview)return; state.timer.taskId=null; state.timer.mode='recall'; $('timerMode').value='recall'; $('timerTaskName').textContent=state.currentReview.title; setTimerMinutes(10); startTimer(); }
  function finishRecallPrompt(){ if(!state.currentReview)return; $('reviewTopicLabel').textContent=state.currentReview.title; $('reviewDialog').showModal(); }
  async function rateReview(rating){
    const r=state.currentReview; if(!r)return; r.completed=true;r.rating=rating;r.completed_at=new Date().toISOString(); await persistReview(r);
    state.stats.xp=(state.stats.xp||0)+(rating==='strong'?18:rating==='shaky'?14:10); await persistStats();
    const base=[1,3,7,14,30], nextStage=Math.min(r.stage+1,base.length-1); let interval=base[nextStage]; if(rating==='weak') interval=Math.max(1,Math.floor(interval/2)); if(rating==='strong') interval=Math.ceil(interval*1.25);
    const m=r.microtopic_id?state.microtopics.find(x=>x.id===r.microtopic_id):null;
    if(m){ m.strength=rating; m.status=(r.stage>=base.length-1 && rating==='strong')?'mastered':'studied'; m.last_studied_at=new Date().toISOString(); await persistMicrotopic(m); }
    if(r.stage<base.length-1 || rating!=='strong'){ const next={...r,id:uuid(),stage:r.stage<base.length-1?nextStage:r.stage,due_date:addDays(todayISO(),interval),completed:false,rating:null,completed_at:null,created_at:new Date().toISOString()}; state.reviews.push(next); await persistInsert('scc_reviews',next); }
    state.currentReview=null; $('reviewDialog').close(); renderAll(); toast(m?.status==='mastered'?'Topic mastered.':'Review scheduled automatically.');
  }

  function renderRevision(){
    const rows=state.reviews.filter(r=>!r.completed).sort((a,b)=>a.due_date.localeCompare(b.due_date)); $('revisionList').innerHTML=rows.length?rows.map(r=>`<div class="stack-item"><div><strong>${esc(r.title)}</strong><small>${esc(r.subject||'')} · ${esc(r.exam||'')} · Review ${r.stage+1}</small></div><div>Due ${esc(r.due_date)}</div></div>`).join(''):'<div class="empty-state">No scheduled reviews yet.</div>';
  }

  async function saveTaskFromForm(e){ e.preventDefault(); const row={id:uuid(),user_id:state.offline?'offline':state.user.id,exam_id:$('taskExam').value||null,title:$('taskTitle').value.trim(),subject:$('taskSubject').value.trim(),topic:$('taskTopic').value.trim(),task_type:$('taskType').value,scheduled_date:$('taskDate').value||todayISO(),estimated_minutes:+$('taskMinutes').value||30,priority:+$('taskPriority').value||3,source:'manual',completed:false,actual_minutes:0,xp_awarded:0,sort_order:state.tasks.filter(t=>t.scheduled_date===($('taskDate').value||todayISO())).length+1}; if(!row.title)return; state.tasks.push(row); await persistInsert('scc_tasks',row); $('taskDialog').close(); $('taskForm').reset(); $('taskDate').value=todayISO(); $('taskMinutes').value=30; renderAll(); toast('Task added.'); }

  async function saveErrorFromForm(e){ e.preventDefault(); const row={id:uuid(),user_id:state.offline?'offline':state.user.id,exam:$('errorExam').value,subject:$('errorSubject').value.trim(),topic:$('errorTopic').value.trim(),created_at:new Date().toISOString()}; if(!row.subject||!row.topic)return; state.errors.unshift(row); await persistInsert('scc_errors',row); $('errorDialog').close(); $('errorForm').reset(); renderErrors(); toast('Error saved.'); }
  function renderErrors(){ const q=$('errorSearch').value.toLowerCase(), ex=$('errorExamFilter').value; const rows=state.errors.filter(r=>(!ex||r.exam===ex)&&(!q||(r.topic+' '+r.subject).toLowerCase().includes(q))); $('errorList').innerHTML=rows.length?rows.map(r=>`<div class="error-item"><div><strong>${esc(r.topic)}</strong><small>${esc(r.subject)} · ${esc(r.exam)}</small></div><button class="btn subtle" data-delete-error="${r.id}">Delete</button></div>`).join(''):'<div class="empty-state">No errors logged.</div>'; $('errorList').querySelectorAll('[data-delete-error]').forEach(b=>b.onclick=()=>deleteError(b.dataset.deleteError)); }
  async function deleteError(id){ state.errors=state.errors.filter(x=>x.id!==id); if(state.offline)saveLocal();else await sb.from('scc_errors').delete().eq('id',id); renderErrors(); }

  async function autoPlanForToday(){
    if(state.offline || !state.microtopics.length) return;
    const today=todayISO();
    const key=`scc_plan_engine_${state.user?.id||'offline'}_${today}`;
    const needsUpgrade=localStorage.getItem(key)!==PLAN_ENGINE_VERSION;
    const hasPlanner=state.tasks.some(t=>t.scheduled_date===today&&!t.completed&&['planner','planner_support'].includes(t.source));
    // A new planner engine automatically replaces only unfinished generated work.
    // Manual and completed tasks are never touched.
    if(needsUpgrade || !hasPlanner){
      await buildDayPlan(needsUpgrade,true);
      localStorage.setItem(key,PLAN_ENGINE_VERSION);
    }
  }

  async function replan(){ await buildDayPlan(true,false); localStorage.setItem(`scc_plan_engine_${state.user?.id||'offline'}_${todayISO()}`,PLAN_ENGINE_VERSION); }

  function pscPlanForDate(date=todayISO()){ return window.SCC_PSC_40_DAY_PLAN?.[date]||null; }
  async function addPlannerSupport({exam_id,title,subject,topic,task_type,minutes,priority=4,sort_order}){
    const row={id:uuid(),user_id:state.offline?'offline':state.user.id,microtopic_id:null,exam_id,title,subject,topic,task_type,scheduled_date:todayISO(),estimated_minutes:minutes,priority,source:'planner_support',completed:false,actual_minutes:0,xp_awarded:0,sort_order};
    state.tasks.push(row); await persistInsert('scc_tasks',row); return row;
  }

  function pscOrdersDueThrough(date=todayISO()){
    const plan=window.SCC_PSC_40_DAY_PLAN||{}, out=[];
    Object.entries(plan).filter(([d])=>d<=date).sort(([a],[b])=>a.localeCompare(b)).forEach(([d,p])=>{
      if(p?.kind==='study') (p.orders||[]).forEach((order,i)=>out.push({order:Number(order),planDate:d,day:p.day,index:i}));
    });
    return out;
  }

  function plannerTaskRow(m, minutes, sort_order, priority=5){
    return {id:uuid(),user_id:state.offline?'offline':state.user.id,microtopic_id:m.id,exam_id:m.exam_id,title:m.microtopic,subject:m.subject,topic:m.topic,task_type:'study',scheduled_date:todayISO(),estimated_minutes:minutes,priority,source:'planner',completed:false,actual_minutes:0,xp_awarded:0,sort_order};
  }

  async function purgeStaleGeneratedWork(today, rebuild){
    // Generated work from past days is not carried as duplicate task rows. Its unfinished
    // microtopic simply becomes eligible again and is re-prioritised by the planner.
    const stale=state.tasks.filter(t=>!t.completed && ['planner','planner_support','carry_over'].includes(t.source) && (t.scheduled_date<today || (rebuild&&t.scheduled_date===today)));
    if(!stale.length) return;
    const ids=stale.map(t=>t.id), idSet=new Set(ids);
    state.tasks=state.tasks.filter(t=>!idSet.has(t.id));
    if(!state.offline) await sb.from('scc_tasks').delete().in('id',ids);
  }

  function pscPaceSnapshot(today=todayISO()){
    const psc=state.microtopics.filter(m=>examShort(m.exam_id)==='PSC'&&m.counts_toward_completion!==false&&!m.recurring&&m.is_leaf!==false);
    const studied=psc.filter(m=>['studied','mastered'].includes(m.status)).length, remaining=Math.max(0,psc.length-studied);
    const start='2026-09-01';
    const dayMs=86400000, parse=d=>new Date(d+'T00:00:00').getTime();
    const elapsed=Math.max(0,Math.floor((parse(today)-parse(start))/dayMs));
    const targetDays=40;
    const expectedByStart=Math.min(psc.length,Math.floor(psc.length*Math.min(elapsed,targetDays)/targetDays));
    const daysLeft=Math.max(1,Math.floor((parse(PSC_TARGET_DATE)-parse(today))/dayMs)+1);
    const needPerDay=remaining?Math.ceil(remaining/daysLeft):0;
    const delta=studied-expectedByStart;
    const status=remaining===0?'COMPLETE':delta>=needPerDay?'AHEAD':delta<0?'BEHIND':'ON TRACK';
    return {total:psc.length,studied,remaining,daysLeft,needPerDay,status,delta};
  }

  function updatePaceBanner(){
    const el=$('pscPaceBanner'); if(!el)return;
    const p=pscPaceSnapshot();
    if(todayISO()>PSC_HARD_DATE){el.textContent='🎯 Priority: Public Administration + UPSC Ethics. Kerala PSC sprint window has ended.';return;}
    el.textContent=`🎯 PSC 40-DAY SPRINT · ${p.status} · ${p.studied}/${p.total} studied · ${p.remaining} left · pace ${p.needPerDay}/day. Pub Ad + UPSC Ethics get the remaining time.`;
  }

  async function buildDayPlan(rebuild=false,silent=false){
    const today=todayISO(), capacity=+$('energyMode')?.value||state.settings.daily_minutes||240;
    await purgeStaleGeneratedWork(today,rebuild);

    // Manual work is never deleted. It consumes capacity exactly like planned work.
    let used=state.tasks.filter(t=>t.scheduled_date===today&&!t.completed&&!['planner','planner_support','carry_over'].includes(t.source)).reduce((n,t)=>n+(t.estimated_minutes||0),0);
    const overdueManual=state.tasks.filter(t=>!t.completed&&t.source==='manual'&&t.scheduled_date<today).sort((a,b)=>(b.priority||0)-(a.priority||0)||a.scheduled_date.localeCompare(b.scheduled_date));
    for(const t of overdueManual){const mins=t.estimated_minutes||0;if(used+mins<=capacity){t.scheduled_date=today;used+=mins;await persistTask(t);}}

    const sprint=today<=PSC_HARD_DATE, pscPlan=pscPlanForDate(today), examByShort=Object.fromEntries(state.exams.map(e=>[e.short_name,e]));
    let sort=state.tasks.filter(t=>t.scheduled_date===today).length+1,count=0;

    // Reviews are shown above new work, and their time is reserved before any new task is added.
    const duePSC=state.reviews.filter(r=>!r.completed&&r.due_date<=today&&r.exam==='PSC').length;
    const duePub=state.reviews.filter(r=>!r.completed&&r.due_date<=today&&r.exam==='PUB AD').length;
    const dueEthics=state.reviews.filter(r=>!r.completed&&r.due_date<=today&&r.exam==='UPSC GS'&&/ethics/i.test(r.subject||'')).length;
    const dueOther=state.reviews.filter(r=>!r.completed&&r.due_date<=today).length-duePSC-duePub-dueEthics;
    const pscRecallMinutes=Math.min(duePSC*10,sprint?90:60), focusRecallMinutes=Math.min((duePub+dueEthics)*10,sprint?30:90), otherRecallMinutes=sprint?0:Math.min(dueOther*10,30);
    used+=pscRecallMinutes+focusRecallMinutes+otherRecallMinutes;

    const scheduledIds=new Set(state.tasks.filter(t=>!t.completed&&t.microtopic_id&&t.scheduled_date===today).map(t=>t.microtopic_id));
    const eligible=m=>m.is_leaf!==false&&m.counts_toward_completion!==false&&!m.recurring&&!['mastered','studied'].includes(m.status)&&!scheduledIds.has(m.id);
    const remaining=()=>Math.max(0,capacity-used);
    const pace=pscPaceSnapshot(today);

    // PSC pool: missed/today's 40-day-plan items first, then upcoming mapped items, then every
    // genuine remaining PSC syllabus item. Nothing can fall out merely because the PDF did not map it.
    const dueOrders=pscOrdersDueThrough(today),dueRank=new Map();dueOrders.forEach((x,i)=>{if(!dueRank.has(x.order))dueRank.set(x.order,i)});
    const futureRank=new Map();let fi=0;Object.entries(window.SCC_PSC_40_DAY_PLAN||{}).filter(([d,p])=>d>today&&p?.kind==='study').sort(([a],[b])=>a.localeCompare(b)).forEach(([d,p])=>(p.orders||[]).forEach(o=>{o=Number(o);if(!futureRank.has(o))futureRank.set(o,fi++)}));
    const pscPool=state.microtopics.filter(m=>examShort(m.exam_id)==='PSC'&&eligible(m)).sort((a,b)=>{const ao=Number(a.source_order),bo=Number(b.source_order),ad=dueRank.has(ao),bd=dueRank.has(bo),af=futureRank.has(ao),bf=futureRank.has(bo),ag=ad?0:af?1:2,bg=bd?0:bf?1:2;if(ag!==bg)return ag-bg;if(ag===0)return dueRank.get(ao)-dueRank.get(bo);if(ag===1)return futureRank.get(ao)-futureRank.get(bo);return ao-bo;});

    if(sprint){
      // Hard PSC practice obligations. On normal study days these are protected before optional subjects.
      let supportReserve=0;
      if(pscPlan?.kind==='weekly_revision') supportReserve=Math.min(100,remaining());
      else if(pscPlan?.kind==='grand_revision') supportReserve=Math.min(150,remaining());
      else supportReserve=(pscPlan?30:0)+25;

      // Daily coverage target is mathematically derived from ALL unfinished PSC topics and the 40-day target.
      // 10 minutes is the planning unit for one source micro-topic; the timer can continue if a topic genuinely needs longer.
      const maxStudySlots=Math.max(0,Math.floor((remaining()-supportReserve)/10));
      const targetSlots=Math.min(pscPool.length,Math.max(0,Math.min(maxStudySlots,pace.needPerDay)));
      for(const m of pscPool.slice(0,targetSlots)){const row=plannerTaskRow(m,10,sort++);state.tasks.push(row);await persistInsert('scc_tasks',row);used+=10;count++;}

      if(pscPlan?.kind==='weekly_revision'){
        const mins=Math.min(100,remaining());if(mins>=60){await addPlannerSupport({exam_id:examByShort.PSC?.id,title:`PSC Day ${pscPlan.day}: cumulative revision + 100 MCQs + error notebook`,subject:'PSC Weekly Revision',topic:'40-Day Revision Plan',task_type:'mcq',minutes:mins,priority:5,sort_order:sort++});used+=mins;count++;}
      }else if(pscPlan?.kind==='grand_revision'){
        const mins=Math.min(150,remaining());if(mins>=90){await addPlannerSupport({exam_id:examByShort.PSC?.id,title:`PSC Day ${pscPlan.day}: full-length mock + error analysis + weak-area patch`,subject:'PSC Grand Revision',topic:'40-Day Revision Plan',task_type:'mock',minutes:mins,priority:5,sort_order:sort++});used+=mins;count++;}
      }else{
        if(pscPlan&&remaining()>=30){await addPlannerSupport({exam_id:examByShort.PSC?.id,title:`PSC Day ${pscPlan.day}: 50 MCQs from today's scheduled PSC topics`,subject:'PSC Practice',topic:'40-Day Revision Plan',task_type:'mcq',minutes:30,priority:5,sort_order:sort++});used+=30;count++;}
        if(remaining()>=25){await addPlannerSupport({exam_id:examByShort.PSC?.id,title:'Current Affairs: today’s important events, schemes, reports and appointments',subject:'Current Affairs',topic:'Daily Current Affairs',task_type:'current_affairs',minutes:25,priority:5,sort_order:sort++});used+=25;count++;}
      }

      // If today's capacity could not hit the mathematical PSC pace, spend every remaining usable minute on PSC.
      const pscToday=state.tasks.filter(t=>t.scheduled_date===today&&!t.completed&&t.microtopic_id&&examShort(t.exam_id)==='PSC').length;
      if(pscToday<pace.needPerDay){
        const already=new Set(state.tasks.filter(t=>t.scheduled_date===today&&!t.completed&&t.microtopic_id).map(t=>t.microtopic_id));
        for(const m of pscPool){if(pscToday>=pace.needPerDay||remaining()<10)break;if(already.has(m.id))continue;const row=plannerTaskRow(m,10,sort++);state.tasks.push(row);await persistInsert('scc_tasks',row);used+=10;already.add(m.id);count++;}
      }
    }

    // Secondary focus is ONLY Public Administration and UPSC Ethics. All other GS is parked.
    const pubPool=state.microtopics.filter(m=>examShort(m.exam_id)==='PUB AD'&&eligible(m)).sort((a,b)=>(a.source_order||0)-(b.source_order||0));
    const ethicsPool=state.microtopics.filter(m=>examShort(m.exam_id)==='UPSC GS'&&/ethics/i.test(m.subject||'')&&eligible(m)).sort((a,b)=>(a.source_order||0)-(b.source_order||0));
    const addFromPool=async(pool,cap)=>{let spent=0;for(const m of pool){if(remaining()<20||spent+20>cap)break;const row=plannerTaskRow(m,20,sort++,m.priority||3);state.tasks.push(row);await persistInsert('scc_tasks',row);used+=20;spent+=20;count++;}return spent;};
    if(remaining()>=20){
      if(sprint){
        // Alternate the remainder rather than allowing arbitrary GS to enter the plan.
        const secondary=remaining();const pubCap=Math.ceil(secondary*.60/20)*20;await addFromPool(pubPool,pubCap);await addFromPool(ethicsPool,remaining());
      }else{
        const secondary=remaining();await addFromPool(pubPool,Math.ceil(secondary*.60/20)*20);await addFromPool(ethicsPool,remaining());
      }
    }

    const actualToday=state.tasks.filter(t=>t.scheduled_date===today&&!t.completed).reduce((n,t)=>n+(t.estimated_minutes||0),0)+pscRecallMinutes+focusRecallMinutes+otherRecallMinutes;
    const ok=actualToday<=capacity;
    if(!silent)toast(ok?(count?`Plan rebuilt: ${actualToday}/${capacity} min. PSC pace: ${pace.needPerDay} new topics/day.`:`Plan fits ${actualToday}/${capacity} min.`):`Planner safety stop: ${actualToday}/${capacity} min.`);
    renderAll();
  }

  const UPSC_OFFICIAL = {
    'GS I': {
      'Culture': 'Indian culture: Art Forms, literature and Architecture from ancient to modern times',
      'Modern History': 'Modern Indian history from about the middle of the eighteenth century until the present',
      'Freedom Struggle': 'The Freedom Struggle: stages and important contributors/contributions',
      'Post Independence': 'Post-independence consolidation and reorganization within the country',
      'World History': 'World history from the 18th century: industrial revolution, world wars, colonization, decolonization and political philosophies',
      'Society': 'Indian Society, diversity, women, population, poverty, urbanization, globalization, social empowerment, communalism, regionalism and secularism',
      'Physical Geography': 'Salient features of the world’s physical geography',
      'Resources & Industries': 'Distribution of key natural resources and factors responsible for location of industries',
      'Geophysical Phenomena': 'Earthquakes, tsunamis, volcanic activity, cyclones and changes in critical geographical features'
    },
    'GS II': {
      'Constitution': 'Indian Constitution: historical underpinnings, evolution, features, amendments, significant provisions and basic structure',
      'Federalism': 'Union-State responsibilities, federal structure and devolution of powers and finances',
      'Separation of Powers': 'Separation of powers, dispute redressal mechanisms and institutions',
      'Comparative Constitution': 'Comparison of the Indian constitutional scheme with that of other countries',
      'Legislatures': 'Parliament and State legislatures: structure, functioning, powers, privileges and issues',
      'Executive & Judiciary': 'Executive and Judiciary; Ministries and Departments; pressure groups and associations',
      'Representation of People': 'Salient features of the Representation of People’s Act',
      'Constitutional Bodies': 'Constitutional posts and Constitutional Bodies: appointment, powers, functions and responsibilities',
      'Regulatory Bodies': 'Statutory, regulatory and quasi-judicial bodies',
      'Policies & Development': 'Government policies and interventions for development: design and implementation issues',
      'Development Industry': 'Development processes and the role of NGOs, SHGs, donors, charities and other stakeholders',
      'Welfare': 'Welfare schemes and mechanisms for vulnerable sections',
      'Social Sector': 'Health, Education and Human Resources',
      'Poverty & Hunger': 'Issues relating to poverty and hunger',
      'Governance': 'Governance, transparency, accountability, e-governance and Citizens Charters',
      'Civil Services': 'Role of civil services in a democracy',
      'Neighbourhood': 'India and its neighborhood relations',
      'Global Groupings': 'Bilateral, regional and global groupings and agreements involving India',
      'Foreign Policies & Diaspora': 'Effect of policies and politics of countries on India’s interests; Indian diaspora',
      'International Institutions': 'Important international institutions, agencies and fora: structure and mandate'
    },
    'GS III': {
      'Economy': 'Indian Economy: planning, mobilization of resources, growth, development and employment',
      'Inclusive Growth': 'Inclusive growth and issues arising from it',
      'Budgeting': 'Government Budgeting',
      'Agriculture': 'Crops, irrigation, storage, transport, marketing and e-technology for farmers',
      'Farm Support & Food Security': 'Farm subsidies, MSP, PDS, buffer stocks, food security, technology missions and animal-rearing',
      'Food Processing': 'Food processing and related industries; supply chain management',
      'Land Reforms': 'Land reforms in India',
      'Liberalisation & Industry': 'Effects of liberalization, industrial policy and industrial growth',
      'Infrastructure': 'Infrastructure: Energy, Ports, Roads, Airports, Railways etc.',
      'Investment Models': 'Investment models',
      'Science & Technology': 'Science and Technology: developments, applications and effects in everyday life',
      'Indian S&T': 'Achievements of Indians in science and technology; indigenization and new technology',
      'Emerging Technology & IPR': 'IT, Space, Computers, robotics, nano-technology, bio-technology and IPR',
      'Environment': 'Conservation, environmental pollution and degradation, environmental impact assessment',
      'Disaster Management': 'Disaster and disaster management',
      'Extremism': 'Linkages between development and spread of extremism',
      'Security Actors': 'External state and non-state actors creating challenges to internal security',
      'Cyber & Communication Security': 'Communication networks, media/social networking, cyber security and money-laundering',
      'Border & Organised Crime': 'Border security and linkages of organized crime with terrorism',
      'Security Forces': 'Various Security forces and agencies and their mandate'
    },
    'GS IV': {
      'Ethics & Human Interface': 'Ethics and Human Interface; Human Values',
      'Attitude': 'Attitude: content, structure, function, moral and political attitudes, social influence and persuasion',
      'Aptitude & Values': 'Aptitude and foundational values for Civil Service',
      'Emotional Intelligence': 'Emotional Intelligence: concepts, utilities and application in administration and governance',
      'Thinkers': 'Contributions of Moral Thinkers and Philosophers from India and World',
      'Public Service Ethics': 'Public/Civil Service Values and Ethics in Public Administration',
      'Probity': 'Probity in Governance',
      'Case Studies': 'Case Studies on the above issues'
    }
  };
  function includesAny(t,arr){return arr.some(k=>t.includes(k));}
  function upscOfficialPath(m){
    const t=`${m.subject||''} ${m.topic||''} ${m.microtopic||''}`.toLowerCase();
    let paper='GS III', key='Economy';
    // Strong content overrides first. These repair source-tree spillovers before trusting the imported subject label.
    if(includesAny((m.topic||'').toLowerCase(),['ethics basic','ethics and human','probity in governance','attitude','emotional intelligence']) && m.subject!=='Ethics, Integrity & Aptitude'){paper='GS IV';key=includesAny(t,['probity'])?'Probity':includesAny(t,['attitude'])?'Attitude':includesAny(t,['emotional intelligence'])?'Emotional Intelligence':'Ethics & Human Interface';
    } else if(includesAny((m.topic||'').toLowerCase(),['disaster management','natural & man-made disasters','man-made disasters']) && m.subject!=='Disaster Management'){paper='GS III';key='Disaster Management';
    } else if(m.subject==='Infrastructure' && (m.topic||'').trim().toLowerCase()==='agriculture'){paper='GS III';key='Agriculture';
    } else if(includesAny(t,['internal security','terror','insurgen','extremis','naxal','maoist','cyber security','cybersecurity','cyber crime','cybercrime','money laundering','border management','border security','organized crime','organised crime','security force','security forces','paramilitary','intelligence agency','national security','police reform'])){
      paper='GS III';
      if(includesAny(t,['cyber','communication network','social media','money laundering'])) key='Cyber & Communication Security';
      else if(includesAny(t,['border','organized crime','organised crime','terrorism and organized','terrorism and organised'])) key='Border & Organised Crime';
      else if(includesAny(t,['security force','security forces','paramilitary','bsf','crpf','cisf','itbp','assam rifles','national security guard'])) key='Security Forces';
      else if(includesAny(t,['extremis','naxal','maoist','development'])) key='Extremism';
      else key='Security Actors';
    } else if(m.subject==='Ethics, Integrity & Aptitude'){paper='GS IV';
      if(includesAny(t,['case stud']))key='Case Studies'; else if(includesAny(t,['probity','corruption','citizen charter','right to information','rti','code of conduct','code of ethics','work culture','public funds']))key='Probity'; else if(includesAny(t,['emotional intelligence']))key='Emotional Intelligence'; else if(includesAny(t,['attitude','persuasion','social influence']))key='Attitude'; else if(includesAny(t,['thinker','philosopher']))key='Thinkers'; else if(includesAny(t,['aptitude','integrity','impartiality','non-partisanship','objectivity','empathy','tolerance','compassion','dedication to public service']))key='Aptitude & Values'; else if(includesAny(t,['public administration','civil service','public service','ethical governance','corporate governance','international relations','ethical dilemma']))key='Public Service Ethics'; else key='Ethics & Human Interface';
    } else if(['Ancient History','Medieval History','Modern History','Post Independence Consolidation','World History','Indian Culture','Physical Geography','Human Geography','Economic Geography','Indian Society'].includes(m.subject)) {paper='GS I';
      if(m.subject==='Indian Culture'||includesAny(t,['art form','architecture','literature','culture']))key='Culture'; else if(m.subject==='Modern History')key=includesAny(t,['freedom struggle','national movement','gandhi','congress','swadeshi'])?'Freedom Struggle':'Modern History'; else if(m.subject==='Post Independence Consolidation')key='Post Independence'; else if(m.subject==='World History')key='World History'; else if(m.subject==='Indian Society')key='Society'; else if(m.subject==='Physical Geography')key=includesAny(t,['earthquake','tsunami','volcan','cyclone','geophysical'])?'Geophysical Phenomena':'Physical Geography'; else if(['Human Geography','Economic Geography'].includes(m.subject))key='Resources & Industries'; else key='Modern History';
    } else if(['Polity','Governance','Social Justice','International Relations'].includes(m.subject)){paper='GS II';
      if(m.subject==='International Relations'){if(includesAny(t,['neighbour','neighbor']))key='Neighbourhood';else if(includesAny(t,['institution','united nations',' un ','imf','world bank','wto','who ']))key='International Institutions';else if(includesAny(t,['diaspora','foreign policy','developed countr','developing countr']))key='Foreign Policies & Diaspora';else key='Global Groupings';}
      else if(m.subject==='Social Justice'){if(includesAny(t,['poverty','hunger']))key='Poverty & Hunger';else if(includesAny(t,['health','education','human resource']))key='Social Sector';else key='Welfare';}
      else if(m.subject==='Governance'){if(includesAny(t,['civil service']))key='Civil Services';else if(includesAny(t,['ngo','shg','self help','donor','charit']))key='Development Industry';else if(includesAny(t,['policy','policies','intervention','implementation']))key='Policies & Development';else key='Governance';}
      else {if(includesAny(t,['federal','union-state','centre-state','center-state','devolution']))key='Federalism';else if(includesAny(t,['separation of powers','dispute redressal']))key='Separation of Powers';else if(includesAny(t,['parliament','legislature']))key='Legislatures';else if(includesAny(t,['representation of people','rpa','election law']))key='Representation of People';else if(includesAny(t,['constitutional bod','constitutional post','election commission','finance commission','cag','upsc']))key='Constitutional Bodies';else if(includesAny(t,['regulatory','quasi-judicial','statutory bod']))key='Regulatory Bodies';else if(includesAny(t,['executive','judiciary','ministry','ministries','pressure group']))key='Executive & Judiciary';else if(includesAny(t,['comparison','comparative constitution']))key='Comparative Constitution';else key='Constitution';}
    } else {
      paper='GS III';
      if(m.subject==='Environment & Ecology')key='Environment'; else if(m.subject==='Disaster Management')key='Disaster Management'; else if(m.subject==='Internal Security')key='Security Actors'; else if(m.subject==='Science & Technology')key=includesAny(t,['space','robot','nano','biotech','computer','information technology','ipr','intellectual property'])?'Emerging Technology & IPR':'Science & Technology'; else if(m.subject==='Agriculture')key=includesAny(t,['subsid','msp','pds','food security','buffer stock','animal'])?'Farm Support & Food Security':includesAny(t,['food processing'])?'Food Processing':includesAny(t,['land reform'])?'Land Reforms':'Agriculture'; else if(m.subject==='Infrastructure')key='Infrastructure'; else if(m.subject==='Industry')key='Liberalisation & Industry'; else {if(includesAny(t,['budget']))key='Budgeting';else if(includesAny(t,['inclusive growth']))key='Inclusive Growth';else if(includesAny(t,['investment model']))key='Investment Models';else key='Economy';}
    }
    return {paper,official:UPSC_OFFICIAL[paper][key]||key};
  }
  function officialPath(m){
    const ex=examShort(m.exam_id);
    if(ex==='UPSC GS'){const x=upscOfficialPath(m);return {level1:x.paper,level2:x.official,mid:m.topic||''};}
    if(ex==='PUB AD'){const clean=(m.subject||'').replace(/^Paper ([IVX]+) · /,''); const paper=(m.subject||'').startsWith('Paper II')?'Paper II · Indian Administration':'Paper I · Administration Theory';return {level1:paper,level2:clean,mid:m.topic||''};}
    return {level1:m.subject||'PSC',level2:m.topic||m.subject||'Official syllabus',mid:''};
  }
  function renderSubjects(){
    const root=$('subjectCards'), search=($('syllabusSearch')?.value||'').trim().toLowerCase(), examFilter=$('syllabusExamFilter')?.value||'';
    if($('syllabusExamFilter') && !$('syllabusExamFilter').dataset.ready){$('syllabusExamFilter').innerHTML='<option value="">All exams</option>'+state.exams.map(e=>`<option value="${esc(e.short_name)}">${esc(e.name)}</option>`).join('');$('syllabusExamFilter').dataset.ready='1';}
    const sourceRows=state.microtopics.filter(m=>!examFilter||examShort(m.exam_id)===examFilter);
    const rows=sourceRows.map(m=>({...m,_path:officialPath(m)})).filter(m=>{if(!search)return true;return `${examShort(m.exam_id)} ${m._path.level1} ${m._path.level2} ${m._path.mid} ${m.microtopic}`.toLowerCase().includes(search);});
    const tree={}; rows.forEach(m=>{const ex=examShort(m.exam_id)||'Other',a=m._path.level1||'Official syllabus',b=m._path.level2||'General';tree[ex]??={};tree[ex][a]??={};tree[ex][a][b]??=[];tree[ex][a][b].push(m);});
    const counting=rows.filter(m=>m.counts_toward_completion!==false),studied=counting.filter(m=>['studied','mastered'].includes(m.status)).length;
    $('syllabusSummary').innerHTML=`<strong>${rows.length.toLocaleString()}</strong> mapped entries · <strong>${counting.length.toLocaleString()}</strong> completion topics · <strong>${studied.toLocaleString()}</strong> studied<div class="mapping-note">Mapping rule: every row is displayed under an official syllabus heading. Source-tree spillovers are corrected by content, so security material is mapped to GS III Internal Security rather than Environment.</div>`;
    const mark=m=>m.status==='mastered'?'✓✓':m.status==='studied'?'✓':'○', cls=m=>m.status==='mastered'?'mastered':m.status==='studied'?'studied':'';
    root.innerHTML=Object.entries(tree).map(([ex,levels])=>`<details class="tree-exam" ${search?'open':''}><summary><span>${esc(ex)}</span><small>${rows.filter(m=>examShort(m.exam_id)===ex).length} mapped micro-topics</small></summary><div class="tree-children">${Object.entries(levels).map(([l1,groups])=>`<details class="tree-subject" ${search?'open':''}><summary><span>${esc(l1)}</span><small>${Object.values(groups).flat().length}</small></summary><div class="tree-children">${Object.entries(groups).map(([official,ms])=>`<details class="tree-topic" ${search?'open':''}><summary><span>${esc(official)}</span><small>${ms.length}</small></summary><div class="microtopic-list">${ms.map(m=>`<div class="microtopic-row ${cls(m)}"><span class="topic-status">${mark(m)}</span><span class="path-label"><b>${esc(m.microtopic)}</b>${m._path.mid&&m._path.mid!==official?`<small>${esc(m._path.level2)} › ${esc(m._path.mid)} › micro-topic</small>`:`<small>${esc(m._path.level2)} › micro-topic</small>`}</span>${m.recurring?'<em>recurring</em>':m.counts_toward_completion===false?'<em>structural</em>':''}</div>`).join('')}</div></details>`).join('')}</div></details>`).join('')}</div></details>`).join('')||'<div class="empty-state">No syllabus entries match this search.</div>';
  }
  function fmtMinutes(mins){mins=Math.round(mins||0);const h=Math.floor(mins/60),m=mins%60;return h?`${h}h ${m}m`:`${m}m`;}
  function sessionExam(s){const t=state.tasks.find(x=>x.id===s.task_id);return t?examShort(t.exam_id):'';}
  function renderStudyCalendar(){
    const root=$('studyCalendar');if(!root)return;const now=new Date(),y=now.getFullYear(),mo=now.getMonth(),first=new Date(y,mo,1),days=new Date(y,mo+1,0).getDate();
    const byDay={};state.sessions.forEach(s=>{const d=localDateOf(s.ended_at);byDay[d]=(byDay[d]||0)+(Number(s.minutes)||0);});
    const blanks=Array(first.getDay()).fill('<div class="calendar-day empty"></div>').join('');
    const cells=Array.from({length:days},(_,i)=>{const n=i+1,key=`${y}-${String(mo+1).padStart(2,'0')}-${String(n).padStart(2,'0')}`,mins=byDay[key]||0;return `<div class="calendar-day ${key===todayISO()?'today':''}"><span class="day-num">${n}</span>${mins?`<span class="day-min">${fmtMinutes(mins)}</span>`:''}</div>`}).join('');
    root.innerHTML=`<div class="calendar-head"><strong>${new Intl.DateTimeFormat('en-IN',{month:'long',year:'numeric'}).format(now)}</strong><small class="muted">Timer-recorded study time</small></div><div class="calendar-grid">${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d=>`<div class="calendar-dow">${d}</div>`).join('')}${blanks}${cells}</div>`;
  }
  function renderProgress(){
    const today=todayISO(),now=new Date(),weekAgo=new Date(now);weekAgo.setDate(now.getDate()-6);const monthKey=today.slice(0,7);
    const total=state.sessions.reduce((n,s)=>n+(Number(s.minutes)||0),0),todayMin=focusedMinutesToday(),weekMin=state.sessions.filter(s=>new Date(s.ended_at)>=new Date(weekAgo.getFullYear(),weekAgo.getMonth(),weekAgo.getDate())).reduce((n,s)=>n+(Number(s.minutes)||0),0),monthMin=state.sessions.filter(s=>localDateOf(s.ended_at).startsWith(monthKey)).reduce((n,s)=>n+(Number(s.minutes)||0),0);
    const byExam={PSC:0,'PUB AD':0,'UPSC GS':0};state.sessions.forEach(s=>{const ex=sessionExam(s);if(ex in byExam)byExam[ex]+=Number(s.minutes)||0;});
    if($('studyTimeCards'))$('studyTimeCards').innerHTML=`<div class="time-card"><span>Today</span><b>${fmtMinutes(todayMin)}</b><small>resets daily</small></div><div class="time-card"><span>Last 7 days</span><b>${fmtMinutes(weekMin)}</b><small>rolling week</small></div><div class="time-card"><span>This month</span><b>${fmtMinutes(monthMin)}</b><small>${today.slice(0,7)}</small></div><div class="time-card"><span>All time</span><b>${fmtMinutes(total)}</b><small>permanent timer history</small></div><div class="time-card"><span>Kerala PSC</span><b>${fmtMinutes(byExam.PSC)}</b><small>all recorded sessions</small></div><div class="time-card"><span>Public Administration</span><b>${fmtMinutes(byExam['PUB AD'])}</b><small>all recorded sessions</small></div><div class="time-card"><span>UPSC GS / Ethics</span><b>${fmtMinutes(byExam['UPSC GS'])}</b><small>all recorded sessions</small></div>`;
    renderStudyCalendar();
    $('examProgressCards').innerHTML=state.exams.map(ex=>{const ms=state.microtopics.filter(m=>m.exam_id===ex.id&&m.counts_toward_completion!==false),studied=ms.filter(m=>['studied','mastered'].includes(m.status)).length,mastered=ms.filter(m=>m.status==='mastered').length,never=ms.length-studied,due=state.reviews.filter(r=>!r.completed&&r.due_date<=todayISO()&&r.exam===ex.short_name).length,pct=ms.length?Math.round(studied/ms.length*100):0,deadline=deadlineFor(ex.short_name);return `<div class="progress-card"><div class="progress-line"><h3>${esc(ex.name)}</h3><strong>${pct}% studied</strong></div><div class="progress-track"><div class="progress-fill" style="width:${pct}%;background:${esc(ex.color||'#7857ff')}"></div></div><p><strong>${studied}/${ms.length}</strong> studied · <strong>${never}</strong> never studied · <strong>${mastered}</strong> mastered · <strong>${due}</strong> reviews due</p>${deadline?`<small class="muted">Timeline: ${esc(deadline)} · ${daysUntil(deadline)} days left</small>`:''}</div>`}).join('');
    const completed=state.microtopics.filter(m=>['studied','mastered'].includes(m.status)).sort((a,b)=>(b.last_studied_at||'').localeCompare(a.last_studied_at||''));
    $('completedTopicsList').innerHTML=completed.length?completed.slice(0,300).map(m=>`<div class="stack-item"><div><strong>${esc(m.microtopic)}</strong><small>${esc(m.subject)} · ${esc(examShort(m.exam_id))}</small></div><div>${m.status==='mastered'?'Mastered':'Studied'}</div></div>`).join(''):'<div class="empty-state">No syllabus topics completed yet.</div>';
  }

  function renderRewards(){ $('rewardXP').textContent=state.stats.xp||0;$('rewardLevel').textContent=Math.floor((state.stats.xp||0)/500)+1;$('rewardStreak').textContent=state.stats.streak||0;$('xpRules').innerHTML='Task completion: <b>+20 XP</b><br>Focus time: <b>+1 XP per 5 minutes</b><br>Active recall/review: <b>+10 to +18 XP</b><br>Minimum-goal streak bonus: <b>+20 XP</b>'; }
  function updateStatsUI(){ $('streakValue').textContent=state.stats.streak||0;$('xpValue').textContent=state.stats.xp||0;renderRewards(); }

  async function selectTaskTimer(id){
    if(state.timer.running || state.timer.accumulated>0) await pauseTimer(true);
    const t=state.tasks.find(x=>x.id===id); if(!t)return;
    state.timer.taskId=id; state.timer.mode='countdown'; $('timerMode').value='countdown';
    $('timerTaskName').textContent=t.title; await setTimerMinutes(t.estimated_minutes,false); window.scrollTo({top:0,behavior:'smooth'});
    setTimerStatus(`Ready · ${t.actual_minutes||0} min already studied`,'ready');
  }
  async function setTimerMinutes(min, saveExisting=true){
    if(saveExisting && (state.timer.running || state.timer.accumulated>0)) await pauseTimer(true);
    else stopTimerInterval();
    state.timer.total=min*60; state.timer.left=state.timer.total; state.timer.startLeft=state.timer.total; state.timer.accumulated=0; updateTimerDisplay();
    setTimerStatus(`Ready for ${min} minutes`,'ready');
  }
  function updateTimerDisplay(){
    const safe=Math.max(0,Math.round(state.timer.left)); const m=Math.floor(safe/60),s=safe%60;
    $('timerDisplay').textContent=`${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    const pct=state.timer.total?Math.min(100,Math.max(0,(state.timer.total-safe)/state.timer.total*100)):0;
    if($('timerProgressFill')) $('timerProgressFill').style.width=`${pct}%`;
  }
  function setTimerStatus(text,kind='ready'){
    const el=$('timerStatus'); if(!el)return; el.textContent=text; el.dataset.kind=kind;
  }
  function stopTimerInterval(){ if(state.timer.interval)clearInterval(state.timer.interval); state.timer.interval=null; state.timer.running=false; }
  function timerTick(){
    if(!state.timer.running)return;
    const elapsed=Math.floor((Date.now()-state.timer.startedAt)/1000);
    state.timer.accumulated=elapsed; state.timer.left=Math.max(0,state.timer.startLeft-elapsed); updateTimerDisplay();
    if(state.timer.left<=0) finishTimer();
  }
  function startTimer(){
    if(state.timer.running)return;
    state.timer.running=true; state.timer.startedAt=Date.now(); state.timer.startLeft=state.timer.left;
    setTimerStatus('● Focusing now','running');
    $('timerStartBtn').textContent='▶ Running';
    state.timer.interval=setInterval(timerTick,250); timerTick();
  }
  async function pauseTimer(save=true){
    if(state.timer.running) timerTick();
    stopTimerInterval(); $('timerStartBtn').textContent='▶ Start';
    let saved=0;
    if(save && state.timer.accumulated>0) saved=await recordTimerSession(state.timer.accumulated);
    state.timer.accumulated=0;
    setTimerStatus(saved?`Paused · ${saved} min saved to your study time`:'Paused','paused');
    renderAll();
    return saved;
  }
  async function resetTimer(){
    if(state.timer.running || state.timer.accumulated>0) await pauseTimer(true); else stopTimerInterval();
    state.timer.left=state.timer.total; state.timer.startLeft=state.timer.total; state.timer.accumulated=0; updateTimerDisplay();
    setTimerStatus('Reset · saved study time is kept','ready');
  }
  async function finishTimer(){
    if(!state.timer.running)return;
    timerTickSafeStop();
    const saved=await recordTimerSession(state.timer.accumulated);
    state.timer.accumulated=0; state.timer.left=0; updateTimerDisplay(); $('timerStartBtn').textContent='▶ Start';
    setTimerStatus(`✓ Session complete · ${saved} min saved`,'done');
    renderAll(); signalTimerComplete(saved);
    if(state.timer.mode==='recall')finishRecallPrompt();
  }
  function timerTickSafeStop(){
    if(state.timer.running){ const elapsed=Math.floor((Date.now()-state.timer.startedAt)/1000); state.timer.accumulated=elapsed; state.timer.left=Math.max(0,state.timer.startLeft-elapsed); }
    stopTimerInterval();
  }
  function signalTimerComplete(saved){
    try{
      const AC=window.AudioContext||window.webkitAudioContext; if(AC){ const ctx=new AC(); [0,.18,.36].forEach((delay,i)=>{const o=ctx.createOscillator(),g=ctx.createGain();o.connect(g);g.connect(ctx.destination);o.frequency.value=[660,880,1040][i];g.gain.setValueAtTime(.12,ctx.currentTime+delay);g.gain.exponentialRampToValueAtTime(.001,ctx.currentTime+delay+.22);o.start(ctx.currentTime+delay);o.stop(ctx.currentTime+delay+.23);}); }
    }catch(e){}
    const oldTitle=document.title; document.title='⏰ TIME UP · Study Command Centre'; setTimeout(()=>document.title=oldTitle,12000);
    if($('timerDoneText')) $('timerDoneText').textContent=`${saved} minute${saved===1?'':'s'} saved. ${$('timerTaskName').textContent||'Session'} is finished.`;
    try{ if($('timerDoneDialog') && !$('timerDoneDialog').open) $('timerDoneDialog').showModal(); }catch(e){}
    toast(`⏰ Time up! ${saved} min saved.`);
  }
  function localDateOf(iso){ if(!iso)return''; const d=new Date(iso); const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,'0'),day=String(d.getDate()).padStart(2,'0'); return `${y}-${m}-${day}`; }
  function focusedMinutesToday(){ return state.sessions.filter(x=>localDateOf(x.ended_at)===todayISO()).reduce((n,x)=>n+(Number(x.minutes)||0),0); }
  async function recordTimerSession(seconds=state.timer.accumulated){
    if(!seconds || seconds<1)return 0;
    const mins=Math.max(1,Math.round(seconds/60));
    if(state.timer.taskId){const t=state.tasks.find(x=>x.id===state.timer.taskId);if(t){t.actual_minutes=(t.actual_minutes||0)+mins;await persistTask(t);}}
    const row={id:uuid(),user_id:state.offline?'offline':state.user.id,task_id:state.timer.taskId,mode:state.timer.mode,minutes:mins,started_at:new Date(Date.now()-seconds*1000).toISOString(),ended_at:new Date().toISOString()};
    state.sessions.unshift(row); await persistInsert('scc_sessions',row); updateStudyTimeUI(); return mins;
  }
  function updateStudyTimeUI(){
    const mins=focusedMinutesToday();
    if($('focusMinutesValue')) $('focusMinutesValue').textContent=mins;
    if($('focusTodayText')) $('focusTodayText').textContent=`${mins} min studied today`;
  }

  async function saveSettings(){ state.settings.daily_minutes=+$('dailyMinutesSetting').value||240;state.settings.minimum_goal=+$('minimumGoalSetting').value||3;state.settings.pomodoro_focus=+$('pomodoroFocusSetting').value||25;state.settings.pomodoro_break=+$('pomodoroBreakSetting').value||5;if(state.offline)saveLocal();else await sb.from('scc_settings').upsert({...state.settings,user_id:state.user.id,updated_at:new Date().toISOString()});hydrateSettings();renderToday();toast('Settings saved.'); }

  function switchView(view){ document.querySelectorAll('.view').forEach(v=>v.classList.remove('active-view')); $(view+'View').classList.add('active-view'); document.querySelectorAll('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.view===view)); if(view==='progress')renderProgress(); }

  async function persistInsert(table,row){ if(state.offline){saveLocal();return;} const clean={...row}; if(String(clean.id).length<30) delete clean.id; const {error}=await sb.from(table).insert(clean); if(error){console.error(error);toast('Sync error: '+error.message);} }
  async function persistTask(t){ if(state.offline){saveLocal();return;} const {error}=await sb.from('scc_tasks').update({scheduled_date:t.scheduled_date,source:t.source,completed:t.completed,completed_at:t.completed_at,actual_minutes:t.actual_minutes,xp_awarded:t.xp_awarded,updated_at:new Date().toISOString()}).eq('id',t.id); if(error)console.error(error); }
  async function persistMicrotopic(m){ if(state.offline){saveLocal();return;} const {error}=await sb.from('scc_microtopics').update({status:m.status,strength:m.strength,last_studied_at:m.last_studied_at}).eq('id',m.id); if(error)console.error(error); }
  async function persistReview(r){ if(state.offline){saveLocal();return;} await sb.from('scc_reviews').update({completed:r.completed,rating:r.rating,completed_at:r.completed_at}).eq('id',r.id); }
  async function persistStats(){ if(state.offline){saveLocal();return;} await sb.from('scc_stats').upsert({...state.stats,user_id:state.user.id,updated_at:new Date().toISOString()}); }

  init();
})();

