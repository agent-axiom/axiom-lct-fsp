// Short, generated data exercises. Not calibrated professional grade assessments.
// No evaluator/oracle code is imported into production.
export function freshCase(skill, level, rng) {
  const int = (min, max) => min + Math.floor(rng() * (max - min + 1));
  const list = (fn, n = 6) => Array.from({length:n}, fn);
  const sum = xs => xs.reduce((a,b) => a+b, 0);
  let data, prompt, answer;
  if (skill === 'Python') {
    data = {values:list(() => int(-8,24)),limit:int(0,12)};
    const filtered = data.values.filter(x => x > data.limit);
    if (level === 0) { prompt='Python: values и limit заданы ниже. Вычислите sum(x for x in values if x > limit).'; answer=sum(filtered); }
    if (level === 1) { prompt='Python: g=(x for x in values if x > limit); next(g, None); print(sum(g)). Какое число напечатано?'; answer=sum(filtered.slice(1)); }
    if (level === 2) { prompt='Python: total=0; для каждого x из values: в try при x <= limit выполняется continue, иначе total += x; в finally всегда total += 1. Каков итоговый total?'; answer=sum(filtered)+data.values.length; }
  } else if (skill === 'SQL') {
    data={rows:list(()=>({g:['a','b','c'][int(0,2)],x:int(0,3)===0?null:int(-4,20)})),limit:int(3,25)};
    if(level===2)delete data.limit; // No irrelevant random field in a window-sum task.
    const groups = {};
    for(const row of data.rows){groups[row.g]??={total:0,nonNull:0,count:0};const g=groups[row.g];g.count++;if(row.x!==null){g.total+=row.x;g.nonNull++;}}
    if(level===0){prompt='SQL: rows — строки t(g,x). Что вернёт SELECT COALESCE(SUM(x),0) FROM t WHERE x > limit? limit задан в данных; NULL имеет стандартную SQL-семантику.';answer=sum(data.rows.filter(r=>r.x!==null&&r.x>data.limit).map(r=>r.x));}
    if(level===1){prompt='SQL: rows — строки t(g,x). Сколько строк вернёт SELECT g FROM t GROUP BY g HAVING SUM(x) > limit? limit задан ниже; SUM игнорирует NULL, а SUM группы только из NULL равен NULL.';answer=Object.values(groups).filter(g=>g.nonNull&&g.total>data.limit).length;}
    if(level===2){prompt='SQL: rows — строки t(g,x). Для каждой исходной строки вычисляется SUM(x) OVER (PARTITION BY g). Сложите все полученные оконные значения (NULL замените на 0). Строки с x=NULL тоже входят в результат окна. Ответ — одна сумма.';answer=sum(Object.values(groups).map(g=>g.total*g.count));}
  } else if (skill === 'HTTP') {
    if(level===0){data={chunks:list(()=>list(()=>int(0,1)?'A':'Б',int(1,5)).join(''))};prompt='HTTP: тело — конкатенация строк chunks в указанном порядке, UTF-8, без сжатия. A занимает 1 байт, Б — 2. Каков Content-Length в байтах?';answer=sum(data.chunks.map(s=>[...s].reduce((n,c)=>n+(c==='A'?1:2),0)));}
    if(level===1){data={limit:int(1,3),events:list(()=>({window:int(0,2)}),8)};prompt='HTTP: fixed-window rate limit — не более limit принятых запросов на окно. Счётчики всех окон изначально 0, отклонённые запросы не увеличивают их. events — запросы в порядке обработки; window указывает окно. Сколько ответов 429?';const counts={};answer=0;for(const e of data.events){counts[e.window]??=0;if(counts[e.window]<data.limit)counts[e.window]++;else answer++;}}
    if(level===2){const version=int(2,12);data={version,requests:list(()=>version+int(0,4),8)};prompt='HTTP: version — начальная версия. requests — значения If-Match последовательных PATCH. Проверка и изменение атомарны: только совпадение с текущей версией успешно и увеличивает её на 1; иначе 412 без изменения. Какова конечная версия?';answer=version;for(const v of data.requests)if(v===answer)answer++;}
  } else if (skill === 'Algorithms') {
    if(level===0){data={values:list(()=>int(0,12),8),target:int(0,12)};prompt='Линейный поиск проверяет values слева направо, останавливаясь на первом target. Если target отсутствует, проверяет весь массив. Сколько сравнений выполнено?';const at=data.values.indexOf(data.target);answer=at<0?data.values.length:at+1;}
    if(level===1){const edges=[];for(let u=0;u<6;u++)for(let v=u+1;v<6;v++)if(rng()<.4)edges.push([u,v]);data={edges,target:int(1,5)};prompt='BFS: неориентированный невзвешенный граф имеет вершины 0..5 и рёбра edges. Какова длина кратчайшего пути из 0 в target в рёбрах? Если пути нет, ответ -1.';const dist=[0,-1,-1,-1,-1,-1],queue=[0];for(let i=0;i<queue.length;i++){const u=queue[i];for(const [a,b] of edges){const v=a===u?b:b===u?a:-1;if(v>=0&&dist[v]<0){dist[v]=dist[u]+1;queue.push(v);}}}answer=dist[data.target];}
    if(level===2){data={capacity:int(2,4),keys:list(()=>int(0,6),8)};prompt='LRU-кэш ёмкости capacity изначально пуст. keys — обращения по порядку. При промахе ключ вставляется; если места нет, вытесняется наименее недавно использованный. Попадание делает ключ самым свежим. Сколько промахов?';const cache=[];answer=0;for(const key of data.keys){const i=cache.indexOf(key);if(i>=0)cache.splice(i,1);else {answer++;if(cache.length===data.capacity)cache.shift();}cache.push(key);}}
  } else if (skill === 'TypeScript') {
    if(level===0){data={values:list(()=>int(-8,24)),limit:int(0,12)};prompt='TypeScript: вычислите values.filter(x => x > limit).map(x => x * 2).reduce((a,b) => a+b, 0).';answer=sum(data.values.filter(x=>x>data.limit).map(x=>x*2));}
    if(level===1){data={values:list(()=>int(0,3)===0?null:int(-5,12)),fallback:int(1,9)};prompt='TypeScript: values имеет тип (number|null)[]. Вычислите values.reduce<number>((s,x) => s + (x ?? fallback), 0). Ноль не является null.';answer=sum(data.values.map(x=>x??data.fallback));}
    if(level===2){data={initial:int(0,8),ops:list(()=>({kind:int(0,1)?'add':'mul',v:int(1,3)}))};prompt="TypeScript: тип операции {kind:'add',v:number}|{kind:'mul',v:number}. Начиная с initial, обработайте ops по порядку: add прибавляет v, mul умножает на v. Каков результат reducer?";answer=data.ops.reduce((n,op)=>op.kind==='add'?n+op.v:n*op.v,data.initial);}
  } else if (skill === 'React') {
    if(level===0){data={initial:int(0,20),values:list(()=>int(-8,18))};prompt='React: count=initial в снимке текущего render. Один обработчик по порядку для каждого x из values вызывает setCount(count+x). Все обновления пакетные; count внутри обработчика не меняется. Каков count после пакета?';answer=data.initial+data.values.at(-1);}
    if(level===1){data={initial:int(0,20),ops:list(()=>({kind:int(0,1)?'replace':'add',v:int(-8,18)}))};prompt='React: count=initial. В одном пакете ops выполняются по порядку: replace — setCount(v), add — setCount(c=>c+v). Каков count после пакета?';answer=data.ops.reduce((n,op)=>op.kind==='replace'?op.v:n+op.v,data.initial);}
    if(level===2){data={latest:int(2,5),responses:list(()=>({id:int(1,5),value:int(1,40)}))};prompt='React: state изначально 0; latestRequestId=latest и не меняется. responses приходят в указанном порядке. Ответ применяется только при id===latestRequestId, заменяя state на value; остальные игнорируются. Каков итоговый state?';answer=0;for(const r of data.responses)if(r.id===data.latest)answer=r.value;}
  } else if (skill === 'CSS') {
    if(level===0){data={boxes:list(()=>({width:int(20,80),padding:int(0,8),border:int(0,3)}))};prompt='CSS: boxes — отдельные блоки content-box. width, padding и border заданы в px; padding/border одинаковы с обеих сторон, margin=0. Найдите сумму внешних ширин всех блоков (не ширину контейнера).';answer=sum(data.boxes.map(b=>b.width+2*b.padding+2*b.border));}
    if(level===1){data={tracks:list(()=>int(20,90)),gap:int(1,12)};prompt='CSS grid: tracks — фиксированные ширины колонок в px, gap — одинаковый промежуток только между соседними колонками. Padding и border нет. Какова суммарная ширина колонок и промежутков?';answer=sum(data.tracks)+(data.tracks.length-1)*data.gap;}
    if(level===2){data={rules:list(()=>({specificity:[int(0,1),int(0,3),int(0,3)],value:int(10,90)}))};prompt='CSS cascade: все rules совпадают с одним элементом и задают width=value px. Один author origin и layer, без !important и inline-стилей, одинаковая scope proximity. specificity=[id,class,type], сравнивается лексикографически; при равенстве побеждает последнее правило. Какова итоговая width в px?';let winner=data.rules[0];for(const r of data.rules){let cmp=0;for(let i=0;i<3&&!cmp;i++)cmp=r.specificity[i]-winner.specificity[i];if(cmp>=0)winner=r;}answer=winner.value;}
  } else if (skill === 'Accessibility') {
    data={elements:list(()=>({disabled:int(0,3)===0,tabindex:level===1?int(-1,3):(int(0,3)===0?-1:0)}))};
    if(level===0)data={elements:list(()=>({disabled:int(0,3)===0,tabindex:int(0,3)===0?-1:0,hidden:int(0,3)===0,inertAncestor:int(0,3)===0}),8)};
    const eligible=data.elements.map((e,i)=>({...e,index:i+1})).filter(e=>!e.disabled&&e.tabindex>=0&&!e.hidden&&!e.inertAncestor);
    const common='HTML: elements — нативные видимые button в DOM-порядке, без скрытых/inert предков; disabled и tabindex указаны. ID — позиция в массиве начиная с 1. ';
    if(level===0){prompt='HTML: elements — восемь нативных button в DOM-порядке. disabled отключает кнопку, hidden скрывает её, inertAncestor означает предка с inert; tabindex задан явно. Других препятствий фокусу нет. Сколько кнопок достижимы последовательным Tab?';answer=eligible.length;}
    if(level===1){data.steps=int(1,7);prompt=common+'Фокус перед первой кнопкой. Положительные tabindex идут по возрастанию, равные — в DOM-порядке, затем tabindex=0 в DOM-порядке. После steps нажатий Tab какой ID получит фокус? Если последовательность закончилась, ответ 0.';eligible.sort((a,b)=>(a.tabindex||Infinity)-(b.tabindex||Infinity)||a.index-b.index);answer=eligible[data.steps-1]?.index??0;}
    if(level===2){if(!eligible.length){data.elements[0]={disabled:false,tabindex:0};eligible.push({...data.elements[0],index:1});}data.current=eligible[int(0,eligible.length-1)].index;data.steps=int(-8,8);prompt=common+'Это focus trap диалога: последовательность только enabled tabindex=0, циклически по DOM. Фокус на current. steps>0 означает Tab, steps<0 — Shift+Tab, 0 — без движения. Каков ID цели после этих шагов?';const start=eligible.findIndex(e=>e.index===data.current);answer=eligible[((start+data.steps)%eligible.length+eligible.length)%eligible.length].index;}
  } else { throw new Error('Unknown fresh skill'); }
  if(!Number.isSafeInteger(answer))throw new Error('Fresh answer must be a safe integer');
  return {text:`${prompt} Ответ одним целым числом.\nДанные: ${JSON.stringify(data)}`,answer:String(answer),format:'number',alternatives:[],applied:true};
}
