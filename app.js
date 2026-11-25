(function () {
  'use strict';
  const D=window.FormulaData,C=window.FormulaCore;
  const $=(selector,scope=document)=>scope.querySelector(selector);
  const $$=(selector,scope=document)=>[...scope.querySelectorAll(selector)];
  const icon=(name,extra='')=>`<svg class="icon ${extra}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const subjectNames={all:'Все предметы',math:'Математика',physics:'Физика'};
  // cards остаётся только для отображения ранее сохранённой истории.
  const modeNames={quiz:'Выбери правильный',build:'Собери формулу',cards:'Карточки (архив)'};
  const storageKey='formula-focus-progress-v1';
  let progress=C.createProgress(),storageAvailable=true,storageWarningShown=false,initialNotice='';
  let config={subject:'all',mode:'quiz',total:10};
  let session=null,currentPage='training',toastTimeout=null,navigating=false;
  try {
    const raw=localStorage.getItem(storageKey);
    if(raw){
      try{progress=C.sanitizeProgress(JSON.parse(raw),D);}
      catch{initialNotice='Сохранённые данные повреждены. Начинаем с чистого листа.';}
    }
    const theme=localStorage.getItem('formula-focus-theme');
    if(theme==='dark')document.documentElement.dataset.theme='dark';
  } catch {storageAvailable=false;}
  function toast(message){clearTimeout(toastTimeout);$('#toast').textContent=message;$('#toast').hidden=false;toastTimeout=setTimeout(()=>{$('#toast').hidden=true;},5500);}
  function save(){
    try{localStorage.setItem(storageKey,JSON.stringify(progress));storageAvailable=true;}
    catch{storageAvailable=false;if(!storageWarningShown){toast('Браузер не разрешил сохранение. Прогресс доступен только до закрытия страницы.');storageWarningShown=true;}}
  }
  function formatDuration(seconds){const n=Math.max(0,Math.round(seconds));return `${Math.floor(n/60)}:${String(n%60).padStart(2,'0')}`;}
  function plural(n,forms){const v=Math.abs(n)%100,k=v%10;return forms[v>10&&v<20?2:k===1?0:k>=2&&k<=4?1:2];}
  function updateTheme(){const dark=document.documentElement.dataset.theme==='dark';$('#theme-toggle').innerHTML=icon(dark?'sun':'moon');$('#theme-toggle').setAttribute('aria-label',dark?'Включить светлую тему':'Включить тёмную тему');}
  function updateHome(){
    const total=C.totals(progress,D),today=progress.days[C.dateKey()]?.answers||0;
    $('#home-mastered').innerHTML=`${total.mastered}<span>/60</span>`;
    $('#home-accuracy').textContent=total.accuracy===null?'—':`${total.accuracy}%`;
    $('#daily-count').textContent=`${today} / 10`;
    $('#daily-progress').value=Math.min(10,today);
    $('#daily-progress').textContent=`${today} из 10`;
    $('#daily-caption').textContent=today>=10?'Цель достигнута. Отличная работа!':'10 ответов — маленькая победа на сегодня';
  }
  function setGroup(selector,attribute,value){$$(selector).forEach(b=>{const on=b.getAttribute(attribute)===String(value);b.classList.toggle('active',on);b.setAttribute('aria-pressed',String(on));});}
  function confirmDialog(selector){return new Promise(resolve=>{const dialog=$(selector);dialog.returnValue='cancel';dialog.addEventListener('close',()=>resolve(dialog.returnValue),{once:true});dialog.showModal();});}
  async function navigate(page,fromHash=false){
    if(navigating)return;
    page=['training','library','stats'].includes(page)?page:'training';
    navigating=true;
    if(session&&page!=='training'){
      const answer=await confirmDialog('#leave-dialog');
      if(answer!=='leave'){if(fromHash)history.replaceState(null,'','#training');navigating=false;return;}
      session=null;showSetup();
    }
    currentPage=page;
    $$('.page').forEach(el=>el.hidden=el.id!==`page-${page}`);
    $$('.nav-link').forEach(link=>{const on=link.dataset.page===page;link.classList.toggle('active',on);if(on)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');});
    const label={training:'Тренировка',library:'Все формулы',stats:'Статистика'}[page];
    $('#page-label').textContent=label;document.title=`${label} — Формула`;
    if(!fromHash&&location.hash!==`#${page}`)history.pushState(null,'',`#${page}`);
    if(page==='training')updateHome();
    if(page==='library')renderLibrary();
    if(page==='stats')renderStats();
    window.scrollTo({top:0,behavior:'instant'});
    navigating=false;
  }
  function showSetup(){
    session=null;
    $$('[data-subject]').forEach(b=>{const on=b.dataset.subject===config.subject;b.classList.toggle('selected',on);b.setAttribute('aria-pressed',String(on));$('.selection-circle',b).textContent=on?'✓':'';});
    setGroup('[data-mode]','data-mode',config.mode);
    setGroup('[data-length]','data-length',config.total);
    $('#time-estimate').textContent={5:'Примерно 2 минуты',10:'Примерно 3 минуты',20:'Примерно 6 минут'}[config.total];
    $('#training-setup').hidden=false;$('#game-container').hidden=true;$('#result-container').hidden=true;updateHome();
  }
  function startSession(onlyIds=null){
    session={subject:onlyIds?'all':config.subject,mode:config.mode,total:config.total,onlyIds,answers:[],retryQueue:[],startedAt:Date.now(),current:null,choices:[],answered:false,showHint:false,feedback:null,assembly:null};
    $('#training-setup').hidden=true;$('#result-container').hidden=true;$('#game-container').hidden=false;
    nextQuestion();window.scrollTo({top:0,behavior:'instant'});
  }
  function nextQuestion(){
    if(!session)return;
    if(session.answers.length>=session.total){finishSession();return;}
    const pick=C.chooseFormula(D,progress,session);
    if(!pick){showSetup();toast('Для этого режима пока нет подходящих формул.');return;}
    session.current=pick.formula;session.isRepeat=pick.isRepeat;
    session.choices=C.shuffle([pick.formula.answer,...pick.formula.wrong]);
    session.answered=false;session.showHint=false;session.feedback=null;
    session.assembly=session.mode==='build'?C.createAssembly(pick.formula):null;
    renderQuestion();
    $('#question-title').focus({preventScroll:true});
  }
  function renderQuestion(){
    if(!session)return;
    const s=session,f=s.current;
    const complete=s.answers.length;
    const answerOptions=s.choices.map((answer,index)=>{
      let state='';
      if(s.answered){if(answer===f.answer)state='correct';else if(answer===s.feedback.selected)state='incorrect';else state='dimmed';}
      const result=state==='correct'?'✓':state==='incorrect'?'×':'';
      return `<button class="answer-option ${state}" data-answer="${index}" ${s.answered?'disabled':''} aria-label="${index+1}. ${esc(answer)}${state==='correct'?'. Правильный ответ':state==='incorrect'?'. Неверный ответ':''}"><span class="answer-key">${index+1}</span><span class="formula">${esc(answer)}</span><span class="answer-status" aria-hidden="true">${result}</span></button>`;
    }).join('');
    let body='';
    if(s.mode==='quiz')body=`<div class="answer-grid" role="group" aria-label="Варианты ответа">${answerOptions}</div>`;
    else body=`<div id="assembly-root">${renderAssembly()}</div>`;
    let feedback='';
    if(s.answered){const correct=s.feedback.correct;feedback=`<div class="feedback ${correct?'':'is-wrong'}" role="status"><h3>${icon(correct?'check':'repeat')}${correct?'Всё верно!':'Ничего страшного — теперь запомнится'}</h3>${!correct?`<span class="formula correct-formula">${esc(f.answer)}</span>`:''}<p>${esc(f.description)}</p>${!correct?'<div class="repetition-info">Вернёмся к этой формуле в следующих вопросах или тренировках.</div>':''}</div>`;}
    $('#game-container').innerHTML=`<div class="session-wrap"><div class="session-top"><span class="session-label">${icon(s.onlyIds?'repeat':'spark')}${s.onlyIds?'Работа над ошибками':subjectNames[s.subject]} <span class="dot-separator">·</span> ${modeNames[s.mode]}</span><span class="session-count">${Math.min(complete+(s.answered?0:1),s.total)} / ${s.total}</span><button id="quit-session" class="quit-button">Выйти ${icon('close')}</button></div><progress class="session-progress" value="${complete}" max="${s.total}" aria-label="Прогресс тренировки">${complete} из ${s.total}</progress><section class="panel question-card"><div class="question-meta"><span>${subjectNames[f.subject]}</span><span class="topic-badge">${esc(f.topic)}</span><span>${f.grade} класс</span>${s.isRepeat?`<span class="repeat-tag">${icon('repeat')}Закрепляем</span>`:''}</div><h2 id="question-title" tabindex="-1">${esc(f.prompt)}</h2><p class="question-description">${s.mode==='quiz'?'Выбери одну верную формулу. Не торопись — таймера нет.':'Собери формулу целиком, слева направо, как в справочнике. Перетащи символы в ячейки; в наборе есть лишние.'}</p>${s.showHint?`<div class="hint-text">${icon('info')} ${esc(f.hint)}</div>`:''}${body}${feedback}<div class="question-footer">${!s.answered&&!s.showHint?`<button id="show-hint" class="hint-button">${icon('info')}Небольшая подсказка</button>`:`<span class="keyboard-hint">${s.answered?'<kbd>Enter</kbd> — продолжить':'Подсказка не влияет на оценку'}</span>`}${s.answered?`<button id="next-question" class="button button-primary">${complete>=s.total?'К результатам':'Следующий вопрос'}${icon('arrow')}</button>`:`<span class="keyboard-hint">${s.mode==='quiz'?'<kbd>1</kbd>–<kbd>4</kbd> — выбрать ответ':'<kbd>Tab</kbd> + <kbd>Enter</kbd> — расставить символы'}</span>`}</div></section><p class="result-notice" style="margin-top:18px">Прогресс сохраняется после каждого ответа.</p></div>`;
  }
  function renderAssembly(){
    const s=session,a=s.assembly,used=new Set(a.slots.filter(tile=>tile!==null));
    const filled=used.size,locked=s.answered;
    const slots=a.slots.map((tile,index)=>{
      const symbol=tile===null?'':a.tiles[tile];
      const state=locked?(symbol===a.tokens[index]?' correct':' incorrect'):index===a.activeSlot?' active':'';
      return `<button type="button" class="assembly-slot formula${tile===null?' empty':''}${state}" data-assembly-slot="${index}" ${tile===null?'':`data-assembly-tile="${tile}"`} ${locked?'disabled':''} draggable="false" aria-label="Ячейка ${index+1}: ${tile===null?'пусто. Нажми, затем выбери символ':esc(symbol)+'. Нажми, чтобы вернуть символ в набор'}" aria-pressed="${!locked&&index===a.activeSlot}"><span>${tile===null?'·':esc(symbol)}</span><small aria-hidden="true">${index+1}</small></button>`;
    }).join('');
    const tiles=a.tiles.map((symbol,index)=>`<button type="button" class="assembly-tile formula${used.has(index)?' used':''}" data-assembly-tile="${index}" ${locked||used.has(index)?'disabled':''} draggable="false" aria-label="Символ ${esc(symbol)}${used.has(index)?', уже в формуле':''}">${esc(symbol)}</button>`).join('');
    return `<section class="assembly" aria-label="Конструктор формулы"><div class="assembly-heading"><strong>Твоя формула</strong><span id="assembly-count" role="status">${filled} из ${a.slots.length} ячеек</span></div><div class="assembly-slots" role="group" aria-label="Ячейки формулы">${slots}</div><p class="assembly-help">Можно перетаскивать или нажимать: выбери пустую ячейку, затем символ. Нажатие на заполненную ячейку вернёт символ в набор. Перетащи один символ на другой, чтобы поменять их местами.</p><div class="assembly-bank" data-assembly-bank role="group" aria-label="Набор символов"><div class="assembly-bank-label">Набор символов <span>Не все пригодятся</span></div><div class="assembly-tiles">${tiles}</div></div>${!locked?`<div class="assembly-actions"><button id="clear-assembly" class="button button-secondary" ${filled?'':'disabled'}>Очистить</button><button id="check-assembly" class="button button-primary" ${C.assemblyComplete(a)?'':'disabled'}>Проверить формулу ${icon('check')}</button></div>`:''}</section>`;
  }
  function updateAssembly(focusSelector){
    const root=$('#assembly-root');if(!root||!session||session.answered)return;
    root.innerHTML=renderAssembly();
    if(focusSelector)$(focusSelector,root)?.focus({preventScroll:true});
  }
  function checkAssembly(){
    if(!session||session.mode!=='build'||session.answered||!C.assemblyComplete(session.assembly))return;
    submitAnswer(C.assemblyCorrect(session.assembly),C.assemblyAnswer(session.assembly));
  }
  function assemblyClick(event){
    if(!session||session.mode!=='build'||session.answered)return false;
    const a=session.assembly,slot=event.target.closest('[data-assembly-slot]');
    if(slot){
      const index=Number(slot.dataset.assemblySlot),tile=a.slots[index];
      if(tile!==null)C.moveAssemblyTile(a,tile,null);
      a.activeSlot=index;updateAssembly(`[data-assembly-slot="${index}"]`);return true;
    }
    const tile=event.target.closest('.assembly-bank [data-assembly-tile]');
    if(tile&&!tile.disabled){
      const target=a.slots[a.activeSlot]===null?a.activeSlot:a.slots.indexOf(null);
      if(target>=0){C.moveAssemblyTile(a,Number(tile.dataset.assemblyTile),target);updateAssembly(`[data-assembly-slot="${a.activeSlot}"]`);}
      return true;
    }
    if(event.target.closest('#clear-assembly')){a.slots.fill(null);a.activeSlot=0;updateAssembly('[data-assembly-slot="0"]');return true;}
    if(event.target.closest('#check-assembly')){checkAssembly();return true;}
    return false;
  }
  // Pointer Events поддерживают мышь, перо и сенсорный экран без библиотек.
  let assemblyDrag=null,suppressAssemblyClick=false;
  function clearDrag(){
    if(assemblyDrag?.frame)cancelAnimationFrame(assemblyDrag.frame);
    assemblyDrag?.ghost?.remove();
    $$('.assembly-drop-target').forEach(el=>el.classList.remove('assembly-drop-target'));
    document.body.classList.remove('assembly-dragging');assemblyDrag=null;
  }
  function highlightAssemblyDrop(x,y){
    $$('.assembly-drop-target').forEach(el=>el.classList.remove('assembly-drop-target'));
    document.elementFromPoint(x,y)?.closest('[data-assembly-slot], [data-assembly-bank]')?.classList.add('assembly-drop-target');
  }
  function scrollAssemblyDrag(){
    const drag=assemblyDrag;if(!drag?.ghost)return;
    if(session!==drag.session||session.assembly!==drag.assembly||session.answered||$('dialog[open]')){clearDrag();return;}
    // Длинные формулы могут занять несколько строк: даём дотащить плитку
    // к ячейкам за пределами экрана, удерживая её у верхнего/нижнего края.
    const edge=65,y=drag.clientY;
    const delta=y<edge?-Math.ceil((edge-y)/5):y>innerHeight-edge?Math.ceil((y-innerHeight+edge)/5):0;
    if(delta){window.scrollBy(0,delta);highlightAssemblyDrop(drag.clientX,y);}
    drag.frame=requestAnimationFrame(scrollAssemblyDrag);
  }
  document.addEventListener('pointerdown',event=>{
    if(!session||session.mode!=='build'||session.answered||$('dialog[open]')||event.button!==0||!event.isPrimary||assemblyDrag)return;
    const tile=event.target.closest('[data-assembly-tile]');if(!tile||tile.disabled)return;
    assemblyDrag={pointerId:event.pointerId,tile:Number(tile.dataset.assemblyTile),x:event.clientX,y:event.clientY,session,assembly:session.assembly,ghost:null};
  });
  document.addEventListener('pointermove',event=>{
    const drag=assemblyDrag;if(!drag||event.pointerId!==drag.pointerId)return;
    if(session!==drag.session||session.assembly!==drag.assembly||session.answered||$('dialog[open]')){clearDrag();return;}
    if(!drag.ghost&&Math.hypot(event.clientX-drag.x,event.clientY-drag.y)<6)return;
    drag.clientX=event.clientX;drag.clientY=event.clientY;
    if(!drag.ghost){
      drag.ghost=document.createElement('div');drag.ghost.className='assembly-drag-ghost formula';drag.ghost.textContent=drag.assembly.tiles[drag.tile];drag.ghost.setAttribute('aria-hidden','true');document.body.append(drag.ghost);document.body.classList.add('assembly-dragging');
      drag.frame=requestAnimationFrame(scrollAssemblyDrag);
    }
    event.preventDefault();
    drag.ghost.style.left=`${event.clientX}px`;drag.ghost.style.top=`${event.clientY}px`;
    highlightAssemblyDrop(event.clientX,event.clientY);
  },{passive:false});
  document.addEventListener('pointerup',event=>{
    const drag=assemblyDrag;if(!drag||event.pointerId!==drag.pointerId)return;
    if(drag.ghost){
      suppressAssemblyClick=true;setTimeout(()=>{suppressAssemblyClick=false;},0);
      if(session===drag.session&&session.assembly===drag.assembly&&!session.answered&&!$('dialog[open]')){
        const target=document.elementFromPoint(event.clientX,event.clientY);
        const slot=target?.closest('[data-assembly-slot]'),bank=target?.closest('[data-assembly-bank]');
        if(slot||bank){C.moveAssemblyTile(drag.assembly,drag.tile,slot?Number(slot.dataset.assemblySlot):null);updateAssembly(slot?`[data-assembly-slot="${slot.dataset.assemblySlot}"]`:`.assembly-bank [data-assembly-tile="${drag.tile}"]`);}
      }
    }
    clearDrag();
  });
  document.addEventListener('pointercancel',clearDrag);
  window.addEventListener('blur',clearDrag);
  document.addEventListener('click',event=>{if(suppressAssemblyClick){event.preventDefault();event.stopImmediatePropagation();}},{capture:true});
  function submitAnswer(correct,selected=null){
    if(!session||session.answered)return;
    if(session.mode==='build'&&!C.assemblyComplete(session.assembly))return;
    session.answered=true;session.feedback={correct,selected};
    const id=session.current.id;
    session.answers.push({id,correct,selected,hinted:session.showHint});
    C.recordAnswer(progress,id,correct);
    session.retryQueue=session.retryQueue.filter(item=>item.id!==id);
    if(!correct)session.retryQueue.push({id,due:session.answers.length+2});
    save();renderQuestion();$('#next-question').focus({preventScroll:true});
  }
  function finishSession(){
    const s=session;if(!s)return;
    const correct=s.answers.filter(a=>a.correct).length;
    const duration=(Date.now()-s.startedAt)/1000;
    progress.sessions.push({id:`${s.startedAt}-${Math.random().toString(36).slice(2,8)}`,subject:s.subject,mode:s.mode,total:s.total,correct,endedAt:Date.now(),duration:Math.round(duration)});
    progress.sessions=progress.sessions.slice(-100);save();
    const percent=Math.round(correct/s.total*100);
    const wrongIds=[...new Set(s.answers.filter(a=>!a.correct).map(a=>a.id))];
    const summaryTitle=percent===100?'Ни одной ошибки!':percent>=70?'Отличный подход!':'Ты уже знаешь больше.';
    const reviewIds=[...new Set(s.answers.map(a=>a.id))];
    $('#game-container').hidden=true;$('#result-container').hidden=false;
    $('#result-container').innerHTML=`<div class="result-wrap"><div class="result-hero"><span class="result-icon">${icon(percent===100?'spark':'check')}</span><div class="eyebrow" style="justify-content:center">ЕЩЁ ОДИН ШАГ ВПЕРЁД</div><h1 id="result-title" tabindex="-1">${summaryTitle}</h1><p>${wrongIds.length?'Ошибки — это подсказки, что повторить. Мы их уже запомнили.':'Все ответы верные. Возвращайся завтра, чтобы закрепить результат.'}</p></div><div class="panel result-summary"><div><strong>${correct}<span style="display:inline;font-size:16px">/${s.total}</span></strong><span>правильных ответов</span></div><div><strong>${percent}%</strong><span>точность</span></div><div><strong>${formatDuration(duration)}</strong><span>время тренировки</span></div></div><div class="result-actions"><button id="train-again" class="button button-primary">Ещё один подход ${icon('arrow')}</button>${wrongIds.length?`<button id="retry-mistakes" class="button button-secondary">${icon('repeat')}Повторить ошибки</button>`:''}<button id="back-to-setup" class="button button-secondary">На главную</button></div><section class="panel review-list"><h2>Что повторили</h2>${reviewIds.map(id=>{const f=D.find(f=>f.id===id),answers=s.answers.filter(a=>a.id===id),hadWrong=answers.some(a=>!a.correct);return `<div class="review-item"><span class="review-marker ${hadWrong?'wrong':''}" aria-label="${hadWrong?'Была ошибка':'Верно'}">${hadWrong?'↻':'✓'}</span><div><h3>${esc(f.title)}</h3><span class="formula">${esc(f.answer)}</span><p>${answers.length>1?`Повторений: ${answers.length}. `:''}${hadWrong?'Эта формула получит больше внимания в следующих тренировках.':'Хорошая работа — ещё немного практики, и формула закрепится.'}</p></div></div>`;}).join('')}</section></div>`;
    const lastConfig={subject:s.subject,mode:s.mode,total:s.total};
    session=null;updateHome();window.scrollTo({top:0,behavior:'instant'});$('#result-title').focus({preventScroll:true});
    $('#train-again').addEventListener('click',()=>{config={...lastConfig};startSession();});
    $('#back-to-setup').addEventListener('click',showSetup);
    $('#retry-mistakes')?.addEventListener('click',()=>{config={...lastConfig};startSession(wrongIds);});
  }
  function formulaState(f){const s=C.getStat(progress,f.id);if(!s.attempts)return 'Ещё не повторяли';if(C.isMastered(s))return `✓ Освоено · ${s.streak} верных подряд`;if(C.isWeak(s))return `↻ Нужно повторить · ${s.correct}/${s.attempts} верно`;return `В процессе · ${s.correct}/${s.attempts} верно`;}
  function renderLibrary(){
    const subject=$('[data-library-subject].active')?.dataset.librarySubject||'all';
    const query=$('#library-search').value.trim().toLocaleLowerCase('ru');
    const weakOnly=$('#only-weak').checked;
    const items=D.filter(f=>(subject==='all'||f.subject===subject)&&(!weakOnly||C.isWeak(C.getStat(progress,f.id)))&&`${f.title} ${f.topic} ${f.answer} ${f.description}`.toLocaleLowerCase('ru').includes(query));
    $('#library-count').textContent=`${items.length} ${plural(items.length,['формула','формулы','формул'])} из 60 · Нажми на карточку, чтобы разобраться`;
    $('#formula-grid').innerHTML=items.length?items.map(f=>`<details class="panel formula-card"><summary><span class="formula-subject"><span>${subjectNames[f.subject]}</span><span class="topic-badge">${esc(f.topic)} · ${f.grade} кл.</span></span><h3>${esc(f.title)}</h3><span class="formula">${esc(f.answer)}</span><span class="formula-open-hint">Разобраться в формуле</span></summary><div class="formula-details">${esc(f.description)}<p class="formula-state">${esc(formulaState(f))}</p></div></details>`).join(''):`<div class="panel empty-state">${icon('search')}<h2>${weakOnly?'Сложных формул пока нет':'Ничего не нашлось'}</h2><p>${weakOnly?'Пройди тренировку: формулы с ошибками появятся здесь. Или отключи фильтр.':'Попробуй другое слово или выбери все предметы.'}</p></div>`;
  }
  function renderStats(){
    const total=C.totals(progress,D),days=C.dayStreak(progress);
    const weak=D.filter(f=>C.isWeak(C.getStat(progress,f.id))).sort((a,b)=>C.weight(C.getStat(progress,b.id))-C.weight(C.getStat(progress,a.id)));
    const tiles=[['book','Освоено формул',`${total.mastered}/60`,'3 правильных ответа подряд'],['target','Точность ответов',total.accuracy===null?'—':`${total.accuracy}%`,'За всё время'],['bolt','Всего ответов',total.attempts,'Каждый ответ — это практика'],['flame','Дней подряд',days,'Сегодня или со вчерашнего дня']];
    const recentDays=Array.from({length:7},(_,i)=>{const date=new Date();date.setDate(date.getDate()-(6-i));return {date,key:C.dateKey(date)};});
    $('#stats-content').innerHTML=`<div class="stats-tiles">${tiles.map(([i,label,value,caption])=>`<div class="panel stat-tile"><div class="stat-label">${icon(i)}${label}</div><div class="stat-value">${value}</div><div class="stat-caption">${caption}</div></div>`).join('')}</div>${!total.attempts?`<div class="panel empty-state" style="margin-bottom:24px">${icon('spark')}<h2>Здесь начинается твой прогресс</h2><p>Пока ответов нет. Пройди первую тренировку — и статистика оживёт.</p><a class="button button-primary" href="#training" style="margin-top:20px">К тренировке ${icon('arrow')}</a></div>`:''}<div class="stats-grid"><section class="panel stats-section"><div class="section-heading"><h2>Зона роста</h2>${icon('repeat','subtle')}</div><p>Формулы с ошибками и менее чем 3 верными ответами подряд. Показываем первые 5 по приоритету повторения.</p>${weak.length?weak.slice(0,5).map(f=>{const s=C.getStat(progress,f.id);return `<div class="weak-row"><span class="formula">${esc(f.answer)}</span><div><div class="weak-title">${esc(f.title)}</div><div class="weak-info">${subjectNames[f.subject]} · ${s.streak}/3 верных подряд</div></div><span class="weak-errors">↻ ${s.errors} ${plural(s.errors,['ошибка','ошибки','ошибок'])}</span></div>`;}).join(''):`<p style="margin:25px 0">${total.attempts?'Пока здесь чисто. Продолжай в том же духе!':'Здесь появятся формулы, которым нужно чуть больше внимания.'}</p>`}${weak.length?`<button id="practice-weak" class="button button-secondary" style="margin-top:18px">Повторить сложное ${icon('arrow')}</button>`:''}</section><section class="panel stats-section"><h2>Последние 7 дней</h2><p>Реальные ответы, без пропущенных дней. Оба режима.</p><div class="activity-list">${recentDays.map(({date,key})=>{const d=progress.days[key]||{answers:0,correct:0};return `<div class="activity-row"><strong>${key===C.dateKey()?'Сегодня':date.toLocaleDateString('ru-RU',{day:'numeric',month:'long'})}</strong><span>${d.answers} ${plural(d.answers,['ответ','ответа','ответов'])} <span aria-hidden="true">·</span> ${d.answers?`${Math.round(d.correct/d.answers*100)}% верно`:'—'}</span></div>`;}).join('')}</div></section><section class="panel stats-section full"><h2>По предметам</h2><p>«Освоено» — минимум три правильных ответа подряд по формуле. Старые результаты карточек учитываются по самооценке.</p><div class="table-scroll"><table><caption class="skip-link">Прогресс по предметам за всё время</caption><thead><tr><th scope="col">Предмет</th><th scope="col">Ответов</th><th scope="col">Верных</th><th scope="col">Точность</th><th scope="col">Освоено</th></tr></thead><tbody>${['math','physics'].map(subject=>{const t=C.totals(progress,D.filter(f=>f.subject===subject));return `<tr><td>${subjectNames[subject]}</td><td class="numbers">${t.attempts}</td><td class="numbers">${t.correct}</td><td class="numbers">${t.accuracy===null?'—':`${t.accuracy}%`}</td><td class="numbers">${t.mastered} / 30</td></tr>`;}).join('')}</tbody></table></div></section><section class="panel stats-section full"><div class="section-heading"><h2>История тренировок</h2><span class="subtle small">Последние 100 подходов</span></div>${progress.sessions.length?`<div class="table-scroll"><table><caption class="skip-link">Завершённые тренировки от новых к старым</caption><thead><tr><th scope="col">Дата</th><th scope="col">Предмет</th><th scope="col">Режим</th><th scope="col">Результат</th><th scope="col">Время</th></tr></thead><tbody>${[...progress.sessions].reverse().map(s=>`<tr><td class="numbers">${new Date(s.endedAt).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}</td><td>${subjectNames[s.subject]}</td><td><span class="history-badge">${modeNames[s.mode]}</span></td><td class="numbers">${s.correct} / ${s.total} <span class="subtle">(${Math.round(s.correct/s.total*100)}%)</span></td><td class="numbers">${formatDuration(s.duration)}</td></tr>`).join('')}</tbody></table></div>`:'<p>Закончи первый подход — он появится здесь. Ответы из незавершённых тренировок уже учитываются в общей статистике.</p>'}</section></div><p class="small subtle" style="margin-top:20px">Лучшая серия: ${progress.bestStreak} ${plural(progress.bestStreak,['правильный ответ','правильных ответа','правильных ответов'])} подряд. Сохранённые результаты прежнего режима карточек включены в статистику. ${storageAvailable?'Данные хранятся только в этом браузере.':'Сохранение недоступно: скачай статистику перед закрытием страницы.'}</p><div class="stats-actions"><button id="export-stats" class="button button-secondary">${icon('download')}Скачать статистику JSON</button><button id="reset-stats" class="reset-button">Сбросить прогресс</button></div>`;
    $('#practice-weak')?.addEventListener('click',async()=>{await navigate('training');startSession(weak.map(f=>f.id));});
    $('#export-stats').addEventListener('click',()=>{
      const blob=new Blob([JSON.stringify({app:'Формула',exportedAt:new Date().toISOString(),...progress},null,2)],{type:'application/json;charset=utf-8'});
      const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`formula-progress-${C.dateKey()}.json`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);toast('Копия статистики скачана в JSON.');
    });
    $('#reset-stats').addEventListener('click',async()=>{if(await confirmDialog('#reset-dialog')==='reset'){progress=C.createProgress();save();renderStats();updateHome();toast('Прогресс сброшен. Начнём заново!');}});
  }
  // Один обработчик для ссылок и меняющихся игровых элементов.
  document.addEventListener('click',async event=>{
    const link=event.target.closest('a[href^="#"]');
    if(link&&['#training','#library','#stats'].includes(link.getAttribute('href'))){event.preventDefault();await navigate(link.getAttribute('href').slice(1));return;}
    const answer=event.target.closest('[data-answer]');
    if(answer&&session&&!session.answered){const selected=session.choices[Number(answer.dataset.answer)];submitAnswer(selected===session.current.answer,selected);return;}
    if(assemblyClick(event))return;
    if(event.target.closest('#next-question')){nextQuestion();return;}
    if(event.target.closest('#show-hint')&&session){session.showHint=true;renderQuestion();return;}
    if(event.target.closest('#quit-session')){if(await confirmDialog('#leave-dialog')==='leave'){showSetup();window.scrollTo({top:0,behavior:'instant'});}return;}
  });
  $$('[data-subject]').forEach(button=>button.addEventListener('click',()=>{
    config.subject=button.dataset.subject;
    $$('[data-subject]').forEach(b=>{const on=b===button;b.classList.toggle('selected',on);b.setAttribute('aria-pressed',String(on));$('.selection-circle',b).textContent=on?'✓':'';});
  }));
  $$('[data-mode]').forEach(b=>b.addEventListener('click',()=>{config.mode=b.dataset.mode;setGroup('[data-mode]','data-mode',config.mode);}));
  $$('[data-length]').forEach(b=>b.addEventListener('click',()=>{config.total=Number(b.dataset.length);setGroup('[data-length]','data-length',config.total);$('#time-estimate').textContent={5:'Примерно 2 минуты',10:'Примерно 3 минуты',20:'Примерно 6 минут'}[config.total];}));
  $$('[data-library-subject]').forEach(b=>b.addEventListener('click',()=>{setGroup('[data-library-subject]','data-library-subject',b.dataset.librarySubject);renderLibrary();}));
  $('#library-search').addEventListener('input',renderLibrary);$('#only-weak').addEventListener('change',renderLibrary);
  $('#start-training').addEventListener('click',()=>startSession());
  $('#theme-toggle').addEventListener('click',()=>{document.documentElement.dataset.theme=document.documentElement.dataset.theme==='dark'?'light':'dark';try{localStorage.setItem('formula-focus-theme',document.documentElement.dataset.theme);}catch{}updateTheme();});
  document.addEventListener('keydown',event=>{
    if(!session||currentPage!=='training'||event.altKey||event.ctrlKey||event.metaKey||event.repeat||event.isComposing||$('dialog[open]')||['INPUT','TEXTAREA','SELECT'].includes(event.target.tagName))return;
    if(event.key==='Enter'){
      // Не перехватываем Enter у кнопок: их нативный click уже делает нужное действие.
      if(event.target.closest('button,a,summary'))return;
      if(session.answered){event.preventDefault();nextQuestion();}
      else if(session.mode==='build'){event.preventDefault();checkAssembly();}
    }
    if(/^[1-4]$/.test(event.key)&&!session.answered){
      if(session.mode==='quiz'){event.preventDefault();const selected=session.choices[Number(event.key)-1];submitAnswer(selected===session.current.answer,selected);}
    }
  });
  window.addEventListener('hashchange',()=>navigate(location.hash.slice(1),true));
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)updateHome();});
  updateTheme();updateHome();navigate(location.hash.slice(1)||'training',true);
  if(!storageAvailable){toast('Сохранение недоступно. Прогресс будет храниться до закрытия страницы.');storageWarningShown=true;}
  else if(initialNotice)toast(initialNotice);
})();
