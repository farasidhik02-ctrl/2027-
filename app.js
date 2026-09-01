(() => {
  const cfg = window.SCC_CONFIG || {};
  const sb = window.supabase && cfg.SUPABASE_URL && cfg.SUPABASE_KEY
    ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_KEY)
    : null;

  const $ = (id) => document.getElementById(id);
  const todayISO = () => new Date().toISOString().slice(0,10);
  const addDays = (dateStr, days) => { const d = new Date(dateStr+'T12:00:00'); d.setDate(d.getDate()+days); return d.toISOString().slice(0,10); };
  const esc = (s='') => String(s).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const uuid = () => crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)+Date.now();

  const state = {
    user: null, offline: false, settings: {daily_minutes:240, minimum_goal:3, pomodoro_focus:25, pomodoro_break:5},
    exams: [], microtopics: [], tasks: [], reviews: [], errors: [], stats: {xp:0, streak:0, longest_streak:0, last_goal_date:null},
    timer: {taskId:null, mode:'countdown', total:1500, left:1500, running:false, interval:null, startedAt:null, accumulated:0},
    currentReview: null
  };

  function toast(msg){ const el=$('toast'); el.textContent=msg; el.classList.add('show'); setTimeout(()=>el.classList.remove('show'),2200); }
  function lsKey(name){ return `scc_${name}`; }
  function loadLocal(){
    ['settings','exams','microtopics','tasks','reviews','errors','stats'].forEach(k=>{ const v=localStorage.getItem(lsKey(k)); if(v) try{state[k]=JSON.parse(v)}catch{} });
  }
  function saveLocal(){ ['settings','exams','microtopics','tasks','reviews','errors','stats'].forEach(k=>localStorage.setItem(lsKey(k),JSON.stringify(state[k]))); }

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
    $('timerStartBtn').onclick=startTimer; $('timerPauseBtn').onclick=pauseTimer; $('timerResetBtn').onclick=resetTimer;
    $('timerMode').onchange=e=>{state.timer.mode=e.target.value; if(e.target.value==='pomodoro') setTimerMinutes(state.settings.pomodoro_focus); else if(e.target.value==='recall') setTimerMinutes(10);};
    document.querySelectorAll('.timer-presets button').forEach(b=>b.onclick=()=>setTimerMinutes(+b.dataset.min));
    $('saveSettingsBtn').onclick=saveSettings;
    $('errorSearch').oninput=renderErrors; $('errorExamFilter').onchange=renderErrors;
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
    try{ await loadRemote(); if(!state.exams.length) await seedStarterRemote(); await loadRemote(); showApp(); }
    catch(err){ console.error(err); $('authMessage').textContent='Sync tables are not installed yet. You can use offline mode now.'; state.user=null; $('authView').classList.remove('hidden'); }
  }
  function showApp(){ $('authView').classList.add('hidden'); $('app').classList.remove('hidden'); $('syncBadge').textContent=state.offline?'● Offline / local':'● Synced with Supabase'; hydrateSettings(); renderAll(); }

  async function loadRemote(){
    const uid=state.user.id;
    const [settings,exams,microtopics,tasks,reviews,errors,stats]=await Promise.all([
      sb.from('scc_settings').select('*').eq('user_id',uid).maybeSingle(), sb.from('scc_exams').select('*').eq('user_id',uid).order('sort_order'),
      sb.from('scc_microtopics').select('*').eq('user_id',uid), sb.from('scc_tasks').select('*').eq('user_id',uid).order('scheduled_date').order('sort_order'),
      sb.from('scc_reviews').select('*').eq('user_id',uid).order('due_date'), sb.from('scc_errors').select('*').eq('user_id',uid).order('created_at',{ascending:false}),
      sb.from('scc_stats').select('*').eq('user_id',uid).maybeSingle()
    ]);
    const err=[settings,exams,microtopics,tasks,reviews,errors,stats].find(x=>x.error)?.error; if(err) throw err;
    state.settings=settings.data||state.settings; state.exams=exams.data||[]; state.microtopics=microtopics.data||[]; state.tasks=tasks.data||[]; state.reviews=reviews.data||[]; state.errors=errors.data||[]; state.stats=stats.data||state.stats;
  }

  function starterData(){
    const t=todayISO();
    const examDefs=[
      {name:'Kerala PSC University Assistant',short_name:'PSC',deadline:'2026-10-14',color:'#31d47d',sort_order:1},
      {name:'UPSC CSE General Studies',short_name:'UPSC GS',deadline:null,color:'#39a8ff',sort_order:2},
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

  function renderAll(){ fillExamSelects(); renderToday(); renderRecall(); renderCarry(); renderPlan(); renderSubjects(); renderRevision(); renderErrors(); renderProgress(); renderRewards(); updateStatsUI(); }
  function fillExamSelects(){
    const opts='<option value="">No exam</option>'+state.exams.map(e=>`<option value="${e.id}">${esc(e.short_name)} · ${esc(e.name)}</option>`).join(''); $('taskExam').innerHTML=opts;
    const nameOpts=state.exams.map(e=>`<option value="${esc(e.short_name)}">${esc(e.short_name)} · ${esc(e.name)}</option>`).join(''); $('errorExam').innerHTML=nameOpts; $('errorExamFilter').innerHTML='<option value="">All exams</option>'+nameOpts;
  }
  function examShort(id){ return state.exams.find(e=>e.id===id)?.short_name||''; }

  function renderToday(){
    const today=todayISO(); const tasks=state.tasks.filter(t=>t.scheduled_date===today).sort((a,b)=>(a.sort_order||0)-(b.sort_order||0)); const next=tasks.find(t=>!t.completed)?.id;
    $('emptyTasks').classList.toggle('hidden',tasks.length>0);
    $('taskList').innerHTML=tasks.map((t,i)=>`<article class="task-card ${t.completed?'completed':''} ${t.id===next?'next-task':''}" data-task-id="${t.id}">
      <div class="task-number">${t.completed?'✓':i+1}</div><div><div class="task-title">${esc(t.title)}</div><div class="task-sub">${esc(t.subject||'')} ${t.topic?'› '+esc(t.topic):''}</div><div class="task-meta"><span class="tag">${esc(examShort(t.exam_id)||'MANUAL')}</span><span class="tag">${esc(t.task_type)}</span> ⏱ ${t.estimated_minutes} min</div></div>
      <div class="task-actions"><button class="btn ghost task-start" data-action="start">▶ Timer</button><input aria-label="Complete task" type="checkbox" data-action="complete" ${t.completed?'checked':''}></div></article>`).join('');
    $('taskList').querySelectorAll('[data-action="start"]').forEach(b=>b.onclick=()=>selectTaskTimer(b.closest('.task-card').dataset.taskId));
    $('taskList').querySelectorAll('[data-action="complete"]').forEach(c=>c.onchange=()=>toggleTask(c.closest('.task-card').dataset.taskId,c.checked));
    const done=tasks.filter(t=>t.completed).length, goal=state.settings.minimum_goal||3; $('goalDone').textContent=done; $('goalBar').style.width=`${Math.min(100,done/goal*100)}%`;
  }

  async function toggleTask(id,completed){
    const t=state.tasks.find(x=>x.id===id); if(!t) return; const was=t.completed; t.completed=completed; t.completed_at=completed?new Date().toISOString():null;
    if(completed && !was){ const xp=20+Math.floor((t.actual_minutes||0)/5); t.xp_awarded=xp; state.stats.xp=(state.stats.xp||0)+xp; if(['study','mcq','pyq','current_affairs','manual'].includes(t.task_type)) await createFirstReviewForTask(t); }
    if(!completed && was){ state.stats.xp=Math.max(0,(state.stats.xp||0)-(t.xp_awarded||0)); t.xp_awarded=0; }
    await persistTask(t); await persistStats(); await updateStreakIfGoalMet(); renderAll();
  }

  async function createFirstReviewForTask(t){
    if(state.reviews.some(r=>r.task_id===t.id)) return;
    const r={id:uuid(),user_id:state.offline?'offline':state.user.id,microtopic_id:t.microtopic_id||null,task_id:t.id,title:t.title,subject:t.subject||'',exam:examShort(t.exam_id),stage:0,due_date:addDays(todayISO(),1),completed:false,rating:null}; state.reviews.push(r); await persistInsert('scc_reviews',r);
  }

  async function updateStreakIfGoalMet(){
    const day=todayISO(), done=state.tasks.filter(t=>t.scheduled_date===day&&t.completed).length, goal=state.settings.minimum_goal||3; if(done<goal||state.stats.last_goal_date===day)return;
    const yesterday=addDays(day,-1); state.stats.streak=state.stats.last_goal_date===yesterday?(state.stats.streak||0)+1:1; state.stats.longest_streak=Math.max(state.stats.longest_streak||0,state.stats.streak); state.stats.last_goal_date=day; state.stats.xp=(state.stats.xp||0)+20; await persistStats(); toast('Minimum goal hit. Streak protected 🔥');
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
    if(r.stage<base.length-1){ const next={...r,id:uuid(),stage:nextStage,due_date:addDays(todayISO(),interval),completed:false,rating:null,completed_at:null,created_at:new Date().toISOString()}; state.reviews.push(next); await persistInsert('scc_reviews',next); }
    state.currentReview=null; $('reviewDialog').close(); renderAll(); toast('Review scheduled automatically.');
  }

  function renderRevision(){
    const rows=state.reviews.filter(r=>!r.completed).sort((a,b)=>a.due_date.localeCompare(b.due_date)); $('revisionList').innerHTML=rows.length?rows.map(r=>`<div class="stack-item"><div><strong>${esc(r.title)}</strong><small>${esc(r.subject||'')} · ${esc(r.exam||'')} · Review ${r.stage+1}</small></div><div>Due ${esc(r.due_date)}</div></div>`).join(''):'<div class="empty-state">No scheduled reviews yet.</div>';
  }

  async function saveTaskFromForm(e){ e.preventDefault(); const row={id:uuid(),user_id:state.offline?'offline':state.user.id,exam_id:$('taskExam').value||null,title:$('taskTitle').value.trim(),subject:$('taskSubject').value.trim(),topic:$('taskTopic').value.trim(),task_type:$('taskType').value,scheduled_date:$('taskDate').value||todayISO(),estimated_minutes:+$('taskMinutes').value||30,priority:+$('taskPriority').value||3,source:'manual',completed:false,actual_minutes:0,xp_awarded:0,sort_order:state.tasks.filter(t=>t.scheduled_date===($('taskDate').value||todayISO())).length+1}; if(!row.title)return; state.tasks.push(row); await persistInsert('scc_tasks',row); $('taskDialog').close(); $('taskForm').reset(); $('taskDate').value=todayISO(); $('taskMinutes').value=30; renderAll(); toast('Task added.'); }

  async function saveErrorFromForm(e){ e.preventDefault(); const row={id:uuid(),user_id:state.offline?'offline':state.user.id,exam:$('errorExam').value,subject:$('errorSubject').value.trim(),topic:$('errorTopic').value.trim(),created_at:new Date().toISOString()}; if(!row.subject||!row.topic)return; state.errors.unshift(row); await persistInsert('scc_errors',row); $('errorDialog').close(); $('errorForm').reset(); renderErrors(); toast('Error saved.'); }
  function renderErrors(){ const q=$('errorSearch').value.toLowerCase(), ex=$('errorExamFilter').value; const rows=state.errors.filter(r=>(!ex||r.exam===ex)&&(!q||(r.topic+' '+r.subject).toLowerCase().includes(q))); $('errorList').innerHTML=rows.length?rows.map(r=>`<div class="error-item"><div><strong>${esc(r.topic)}</strong><small>${esc(r.subject)} · ${esc(r.exam)}</small></div><button class="btn subtle" data-delete-error="${r.id}">Delete</button></div>`).join(''):'<div class="empty-state">No errors logged.</div>'; $('errorList').querySelectorAll('[data-delete-error]').forEach(b=>b.onclick=()=>deleteError(b.dataset.deleteError)); }
  async function deleteError(id){ state.errors=state.errors.filter(x=>x.id!==id); if(state.offline)saveLocal();else await sb.from('scc_errors').delete().eq('id',id); renderErrors(); }

  async function replan(){
    const today=todayISO(), capacity=+$('energyMode').value||240;
    const overdue=state.tasks.filter(t=>!t.completed&&t.scheduled_date<today).sort((a,b)=>(b.priority||0)-(a.priority||0)); let used=state.tasks.filter(t=>t.scheduled_date===today&&!t.completed).reduce((s,t)=>s+t.estimated_minutes,0);
    for(const t of overdue){ if(used+t.estimated_minutes<=capacity){t.scheduled_date=today;t.source='carry_over';used+=t.estimated_minutes;await persistTask(t);} else {t.scheduled_date=addDays(today,2);t.source='carry_over';await persistTask(t);} }
    renderAll(); toast('Replanned without overloading today.');
  }

  function renderPlan(){ const rows=state.tasks.filter(t=>!t.completed).sort((a,b)=>a.scheduled_date.localeCompare(b.scheduled_date)||(a.sort_order||0)-(b.sort_order||0)); $('planList').innerHTML=rows.map(t=>`<div class="stack-item"><div><strong>${esc(t.title)}</strong><small>${esc(t.subject||'')} · ${esc(examShort(t.exam_id)||'Manual')}</small></div><div>${esc(t.scheduled_date)} · ${t.estimated_minutes}m</div></div>`).join('')||'<div class="empty-state">No upcoming tasks.</div>'; }
  function renderSubjects(){ const map={}; state.microtopics.forEach(m=>{const k=`${examShort(m.exam_id)}|${m.subject}`;(map[k]??=[]).push(m)}); if(!Object.keys(map).length){ const taskGroups={}; state.tasks.forEach(t=>{const k=`${examShort(t.exam_id)||'Manual'}|${t.subject||'Other'}`;(taskGroups[k]??=[]).push(t)}); $('subjectCards').innerHTML=Object.entries(taskGroups).map(([k,arr])=>{const [exam,subject]=k.split('|');return `<div class="subject-card"><h3>${esc(subject)}</h3><p class="muted">${esc(exam)}</p><p>${arr.filter(x=>x.completed).length}/${arr.length} tasks complete</p></div>`}).join('')||'<div class="empty-state">Micro-topic bank will appear here once imported.</div>'; return;} $('subjectCards').innerHTML=Object.entries(map).map(([k,arr])=>{const [exam,subject]=k.split('|');return `<div class="subject-card"><h3>${esc(subject)}</h3><p class="muted">${esc(exam)}</p><p>${arr.filter(x=>x.status==='mastered').length}/${arr.length} mastered</p></div>`}).join(''); }
  function renderProgress(){ $('examProgressCards').innerHTML=state.exams.map(ex=>{const ms=state.microtopics.filter(m=>m.exam_id===ex.id); const mastered=ms.filter(m=>m.status==='mastered').length; const relevantTasks=state.tasks.filter(t=>t.exam_id===ex.id), doneTasks=relevantTasks.filter(t=>t.completed).length; const total=ms.length||relevantTasks.length, done=ms.length?mastered:doneTasks, left=Math.max(0,total-done), pct=total?Math.round(done/total*100):0; return `<div class="progress-card"><div class="progress-line"><h3>${esc(ex.name)}</h3><strong>${pct}%</strong></div><div class="progress-track"><div class="progress-fill" style="width:${pct}%;background:${esc(ex.color||'#7857ff')}"></div></div><p><strong>${left}</strong> micro-topics/tasks left · ${done}/${total} complete</p>${ex.deadline?`<small class="muted">Deadline: ${esc(ex.deadline)}</small>`:''}</div>`}).join(''); }
  function renderRewards(){ $('rewardXP').textContent=state.stats.xp||0;$('rewardLevel').textContent=Math.floor((state.stats.xp||0)/500)+1;$('rewardStreak').textContent=state.stats.streak||0;$('xpRules').innerHTML='Task completion: <b>+20 XP</b><br>Focus time: <b>+1 XP per 5 minutes</b><br>Active recall/review: <b>+10 to +18 XP</b><br>Minimum-goal streak bonus: <b>+20 XP</b>'; }
  function updateStatsUI(){ $('streakValue').textContent=state.stats.streak||0;$('xpValue').textContent=state.stats.xp||0;renderRewards(); }

  function selectTaskTimer(id){ const t=state.tasks.find(x=>x.id===id); if(!t)return; state.timer.taskId=id; state.timer.mode='countdown'; $('timerMode').value='countdown'; $('timerTaskName').textContent=t.title; setTimerMinutes(t.estimated_minutes); window.scrollTo({top:0,behavior:'smooth'}); }
  function setTimerMinutes(min){ pauseTimer(); state.timer.total=min*60;state.timer.left=state.timer.total;state.timer.accumulated=0;updateTimerDisplay(); }
  function updateTimerDisplay(){ const m=Math.floor(state.timer.left/60),s=state.timer.left%60;$('timerDisplay').textContent=`${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`; }
  function startTimer(){ if(state.timer.running)return; state.timer.running=true;state.timer.startedAt=Date.now(); state.timer.interval=setInterval(async()=>{state.timer.left--;state.timer.accumulated++;updateTimerDisplay();if(state.timer.left<=0){pauseTimer();await recordTimerSession();toast('Timer complete.');if(state.timer.mode==='recall')finishRecallPrompt();}},1000); }
  function pauseTimer(){ if(state.timer.interval)clearInterval(state.timer.interval);state.timer.interval=null;state.timer.running=false; }
  function resetTimer(){ pauseTimer();state.timer.left=state.timer.total;state.timer.accumulated=0;updateTimerDisplay(); }
  async function recordTimerSession(){ const mins=Math.max(1,Math.round(state.timer.accumulated/60)); if(state.timer.taskId){const t=state.tasks.find(x=>x.id===state.timer.taskId);if(t){t.actual_minutes=(t.actual_minutes||0)+mins;await persistTask(t);}} const row={id:uuid(),user_id:state.offline?'offline':state.user.id,task_id:state.timer.taskId,mode:state.timer.mode,minutes:mins,started_at:new Date(Date.now()-state.timer.accumulated*1000).toISOString(),ended_at:new Date().toISOString()};await persistInsert('scc_sessions',row); }

  async function saveSettings(){ state.settings.daily_minutes=+$('dailyMinutesSetting').value||240;state.settings.minimum_goal=+$('minimumGoalSetting').value||3;state.settings.pomodoro_focus=+$('pomodoroFocusSetting').value||25;state.settings.pomodoro_break=+$('pomodoroBreakSetting').value||5;if(state.offline)saveLocal();else await sb.from('scc_settings').upsert({...state.settings,user_id:state.user.id,updated_at:new Date().toISOString()});hydrateSettings();renderToday();toast('Settings saved.'); }

  function switchView(view){ document.querySelectorAll('.view').forEach(v=>v.classList.remove('active-view')); $(view+'View').classList.add('active-view'); document.querySelectorAll('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.view===view)); if(view==='progress')renderProgress(); }

  async function persistInsert(table,row){ if(state.offline){saveLocal();return;} const clean={...row}; if(String(clean.id).length<30) delete clean.id; const {error}=await sb.from(table).insert(clean); if(error){console.error(error);toast('Sync error: '+error.message);} }
  async function persistTask(t){ if(state.offline){saveLocal();return;} const {error}=await sb.from('scc_tasks').update({scheduled_date:t.scheduled_date,source:t.source,completed:t.completed,completed_at:t.completed_at,actual_minutes:t.actual_minutes,xp_awarded:t.xp_awarded,updated_at:new Date().toISOString()}).eq('id',t.id); if(error)console.error(error); }
  async function persistReview(r){ if(state.offline){saveLocal();return;} await sb.from('scc_reviews').update({completed:r.completed,rating:r.rating,completed_at:r.completed_at}).eq('id',r.id); }
  async function persistStats(){ if(state.offline){saveLocal();return;} await sb.from('scc_stats').upsert({...state.stats,user_id:state.user.id,updated_at:new Date().toISOString()}); }

  init();
})();
