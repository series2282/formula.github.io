/* Чистая логика обучения: не зависит от DOM или localStorage. */
(function (root) {
  'use strict';
  const dateKey = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  const emptyStat = () => ({ attempts:0, correct:0, errors:0, streak:0, lastAnswered:0, lastWrong:0 });
  const createProgress = () => ({ version:1, formulas:{}, days:{}, sessions:[], currentStreak:0, bestStreak:0 });
  const integer = v => Number.isSafeInteger(v) && v >= 0 ? v : 0;
  const getStat = (progress,id) => progress.formulas[id] || emptyStat();
  const isMastered = stat => stat.attempts >= 3 && stat.streak >= 3;
  const isWeak = stat => stat.errors > 0 && stat.streak < 3;
  function sanitizeProgress(raw, data) {
    const result = createProgress();
    if (!raw || raw.version !== 1 || typeof raw !== 'object') return result;
    for (const f of data) {
      const s = raw.formulas?.[f.id];
      if (!s || typeof s !== 'object') continue;
      const attempts = integer(s.attempts), correct = Math.min(integer(s.correct), attempts);
      result.formulas[f.id] = {attempts,correct,errors:attempts-correct,streak:Math.min(integer(s.streak),correct),lastAnswered:integer(s.lastAnswered),lastWrong:integer(s.lastWrong)};
    }
    if (raw.days && typeof raw.days === 'object') {
      for (const [key,value] of Object.entries(raw.days)) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || !value || typeof value !== 'object') continue;
        const answers = integer(value.answers);
        result.days[key] = {answers,correct:Math.min(integer(value.correct),answers)};
      }
    }
    result.sessions = Array.isArray(raw.sessions) ? raw.sessions.filter(s => s && typeof s.id === 'string' && ['math','physics','all'].includes(s.subject) && ['quiz','build','cards'].includes(s.mode) && [5,10,20].includes(s.total) && Number.isSafeInteger(s.correct) && s.correct >= 0 && s.correct <= s.total && Number.isSafeInteger(s.endedAt) && s.endedAt > 0 && Number.isFinite(s.duration) && s.duration >= 0).slice(-100) : [];
    result.currentStreak = integer(raw.currentStreak);
    result.bestStreak = Math.max(integer(raw.bestStreak), result.currentStreak);
    return result;
  }
  function recordAnswer(progress, id, correct, now = Date.now()) {
    const s = { ...getStat(progress,id) };
    s.attempts++;
    if (correct) {s.correct++;s.streak++;progress.currentStreak++;}
    else {s.errors++;s.streak=0;s.lastWrong=now;progress.currentStreak=0;}
    s.lastAnswered=now;
    progress.bestStreak=Math.max(progress.bestStreak,progress.currentStreak);
    progress.formulas[id]=s;
    const key=dateKey(new Date(now));
    const day=progress.days[key] || {answers:0,correct:0};
    day.answers++;if(correct) day.correct++;
    progress.days[key]=day;
    return s;
  }
  function weight(stat) {
    if (!stat.attempts) return 3.5;
    const smoothedError=(stat.errors+1)/(stat.attempts+3);
    return Math.max(.4,(1+8*smoothedError+(isWeak(stat)?2:0))/(1+.45*Math.min(stat.streak,12)));
  }
  function chooseFormula(data,progress,session,rng=Math.random) {
    const pool=data.filter(f => (session.subject==='all'||f.subject===session.subject) && (!session.onlyIds || session.onlyIds.includes(f.id)));
    if (!pool.length) return null;
    const recent=session.answers.slice(-2).map(a=>a.id);
    const eligible=pool.filter(f=>!recent.includes(f.id));
    const candidates=eligible.length ? eligible : pool;
    const dueIndex=session.retryQueue.findIndex(r=>r.due<=session.answers.length && candidates.some(f=>f.id===r.id));
    if (dueIndex>=0) {
      const [retry]=session.retryQueue.splice(dueIndex,1);
      return {formula:pool.find(f=>f.id===retry.id),isRepeat:true};
    }
    const weighted=candidates.map(formula=>{
      const appearances=session.answers.filter(a=>a.id===formula.id);
      const repeatFactor=appearances.length ? (appearances.at(-1).correct ? .12 : .65) : 1;
      return {formula,weight:weight(getStat(progress,formula.id))*repeatFactor};
    });
    let cursor=rng()*weighted.reduce((sum,item)=>sum+item.weight,0);
    for (const item of weighted) {
      cursor-=item.weight;
      if(cursor<0) return {formula:item.formula,isRepeat:session.answers.some(a=>a.id===item.formula.id)};
    }
    const last=weighted.at(-1).formula;
    return {formula:last,isRepeat:session.answers.some(a=>a.id===last.id)};
  }
  function shuffle(array,rng=Math.random) {
    const result=[...array];
    for(let i=result.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[result[i],result[j]]=[result[j],result[i]];}
    return result;
  }
  // Буквы, знаки и степени — отдельные плитки; названия функций неделимы.
  const tokenizeFormula = formula => String(formula).match(/log|sin|cos|tg|[^\s]/gu) || [];
  function createAssembly(formula,rng=Math.random) {
    const tokens=tokenizeFormula(formula.answer);
    const extraPool=[...new Set([
      ...formula.wrong.flatMap(tokenizeFormula),
      '+','−','×','/','=','²','³','√','π','ρ','λ','μ','ν','Δ','0','1','2','3','4','a','b','c','x','y','m','v','t','(',')'
    ])].filter(token=>!tokens.includes(token));
    const extras=shuffle(extraPool,rng).slice(0,Math.max(4,Math.min(7,Math.ceil(tokens.length/3))));
    return {tokens,tiles:shuffle([...tokens,...extras],rng),slots:tokens.map(()=>null),activeSlot:0};
  }
  function moveAssemblyTile(assembly,tile,target) {
    if(!Number.isInteger(tile)||tile<0||tile>=assembly.tiles.length)return false;
    if(target!==null&&(!Number.isInteger(target)||target<0||target>=assembly.slots.length))return false;
    const source=assembly.slots.indexOf(tile);
    if(source===target)return false;
    if(target===null){if(source<0)return false;assembly.slots[source]=null;assembly.activeSlot=source;return true;}
    const displaced=assembly.slots[target];
    if(source>=0)assembly.slots[source]=displaced;
    assembly.slots[target]=tile;
    const next=assembly.slots.findIndex((value,index)=>index>target&&value===null);
    assembly.activeSlot=next>=0?next:Math.max(0,assembly.slots.indexOf(null));
    return true;
  }
  const assemblyComplete = assembly => assembly.slots.every(tile=>tile!==null);
  const assemblyCorrect = assembly => assemblyComplete(assembly)&&assembly.slots.every((tile,index)=>assembly.tiles[tile]===assembly.tokens[index]);
  const assemblyAnswer = assembly => assembly.slots.map(tile=>tile===null?'□':assembly.tiles[tile]).join('');
  function totals(progress,data) {
    let attempts=0,correct=0,mastered=0;
    for(const f of data){const s=getStat(progress,f.id);attempts+=s.attempts;correct+=s.correct;if(isMastered(s))mastered++;}
    return {attempts,correct,mastered,accuracy:attempts?Math.round(correct/attempts*1000)/10:null};
  }
  function dayStreak(progress,now=new Date()) {
    const date=new Date(now.getFullYear(),now.getMonth(),now.getDate(),12);
    if(!progress.days[dateKey(date)]?.answers) date.setDate(date.getDate()-1);
    let count=0;
    while(progress.days[dateKey(date)]?.answers){count++;date.setDate(date.getDate()-1);}
    return count;
  }
  root.FormulaCore=Object.freeze({dateKey,emptyStat,createProgress,getStat,isMastered,isWeak,sanitizeProgress,recordAnswer,weight,chooseFormula,shuffle,tokenizeFormula,createAssembly,moveAssemblyTile,assemblyComplete,assemblyCorrect,assemblyAnswer,totals,dayStreak});
})(typeof window !== 'undefined' ? window : globalThis);
