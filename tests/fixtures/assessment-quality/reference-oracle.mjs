// Автор: отдельный AI-рецензент assessment, 2026-10-06.
// Создан после чтения реализации, без вызова answerMatches и без чтения question.answer.
// Это проверка семантики учебных задач, не независимая экспертная/психометрическая разметка.
const sum = xs => xs.reduce((a,b)=>a+b,0);
const range = n => Array.from({length:n},(_,i)=>i);
const match = (text,re) => {const m=text.match(re); if(!m)throw new Error(`Не распознан reference prompt: ${text}`);return m.slice(1).map(Number);};
export function parameters(skill,grade,questions){
 const a=i=>questions.find(q=>q.conceptId===`${skill}-${grade}-applied-${i}`).text;
 switch(skill){
 case 'Python':if(grade==='Junior'){const [size,n]=match(a(0),/range\((\d+)\).*a\[(\d+):/);return[n,size-n];}if(grade==='Middle')return[match(a(0),/range\((\d+)\)/)[0],match(a(1),/append\((\d+)\)/)[0]];return match(a(0),/range\((\d+)\).*rotate\((\d+)\)/);
 case 'SQL':return grade==='Junior'?match(a(0),/(\d+) строк amount=(\d+)/):grade==='Middle'?match(a(0),/(\d+) клиентов имеют по (\d+)/):match(a(0),/(\d+) строк группы 'a', x=(\d+)/);
 case 'HTTP':if(grade==='Junior')return match(a(0),/(\d+) латинских символов A и (\d+)/);if(grade==='Middle'){const [size,n]=match(a(0),/лимит (\d+).*приняты (\d+)/);return[n,size-n];}{const[size,m]=match(a(0),/Получены (\d+) POST, среди них (\d+)/);return[size-m,m];}
 case 'Algorithms':if(grade==='Junior'){const[size,m]=match(a(0),/от 1 до (\d+).*выполнены (\d+)/);return[size-m,m];}if(grade==='Middle'){const[size,n]=match(a(1),/0—1—\.\.\.—(\d+).*до (\d+)/);return[n,size-n];}{const[n,processed]=match(a(0),/содержит (\d+).*обрабатываются (\d+)/);return[n,processed/10];}
 case 'TypeScript':return grade==='Junior'?match(a(0),/\[(\d+), (\d+),/):grade==='Middle'?match(a(0),/\?\? (\d+).*\|\| (\d+)/):[match(a(0),/kind:'mul',v:(\d+)/)[0],match(a(0),/x\.v\+(\d+)/)[0]];
 case 'React':return grade==='Junior'?match(a(0),/count=(\d+).*setCount\(count\+(\d+)/):grade==='Middle'?match(a(0),/count=(\d+).*setCount\(count\+(\d+)/):match(a(0),/A получил id=(\d+).*B вернул (\d+)/);
 case 'CSS':if(grade!=='Senior'){const[width,m]=match(a(0),/width:(\d+)px; padding:(\d+)/);return[width/10,m];}{const[min,preferred]=match(a(0),/clamp\((\d+)px, (\d+)px,/);return[min/2,preferred/(min/2)];}
 case 'Accessibility':return grade==='Junior'?match(a(1),/(\d+) обычных button и (\d+)/):grade==='Middle'?match(a(1),/(\d+) button с tabindex="0", (\d+)/):match(a(1),/first-(\d+).*middle-(\d+)/);
 default:throw new Error(skill);
 }
}
// Каждая функция самостоятельно воспроизводит операции из условий. Порядок:
// 4 знания, затем 2 прикладных. Константы размечены автором, не взяты из ключа.
export function referenceAnswers(skill,grade,n,m){
 const size=n+m, key=skill+'-'+grade;
 switch(key){
 case 'Python-Junior':{let original=[n,m],copy=original.slice();copy.push(size);return[sum(range(n)),new Set([n,m,n]).size,Math.trunc(size/m),range(n).map(x=>x*2).at(-1),sum(range(size).slice(n)),original.length*original[0]];}
 case 'Python-Middle':{let a=[n],b=a;b.push(m);let deep=[[n]],shallow=deep.slice();shallow[0].push(m);return[sum(range(n).slice(1)),a.length,({a:n}).b??m,'with',sum(range(n).map(x=>x*2).slice(2)),sum(deep[0])];}
 case 'Python-Senior':{let deque=range(n);for(let i=0;i<m;i++)deque.unshift(deque.pop());let total=0;for(let i=0;i<n;i++){try{if(i%2===0)continue;total+=i;}finally{total+=m;}}return['queue.queue','await','stopiteration','context manager',deque[0],total];}
 case 'SQL-Junior':return[sum([...Array(n).fill(10),...Array(m).fill(20)]),[...Array(n).fill('mail'),...Array(m).fill(null)].filter(x=>x!==null).length,'where',new Set([n,m,n]).size,sum([...Array(n).fill(m),...Array(m).fill(null)].filter(x=>x!==null)),new Set([...range(n).flatMap(x=>Array(m).fill(x+1)),...Array(m).fill(null)].filter(x=>x!==null)).size];
 case 'SQL-Middle':return[range(n).flatMap(()=>range(m)).length,'is null','left',sum([n,m,null].filter(x=>x!==null)),range(n+2).flatMap(i=>i<n?range(m):[null]).length,sum([n,m,null].map(x=>x??size))];
 case 'SQL-Senior':{let balance=n;balance+=m;const saved=balance;balance*=2;balance=saved;return['serializable','a','транзакция','нет',sum(Array(n).fill(m)),balance];}
 case 'HTTP-Junior':return[404,201,'get',401,Buffer.byteLength('A'.repeat(n)+'Б'.repeat(m),'utf8'),range(n+m).filter(x=>x>=n&&x<=n+m-1).length];
 case 'HTTP-Middle':{let remaining=size-n,rejected=0;for(let i=0;i<size;i++){if(remaining>0)remaining--;else rejected++;}return['put','content-type',409,429,rejected,412];}
 case 'HTTP-Senior':{let version=n;for(let i=0;i<m;i++)if(version===n)version++;return['if-match','idempotency key','retry-after',304,new Set(range(size).map(i=>i%m)).size,version];}
 case 'Algorithms-Junior':{let stack=range(size).map(i=>i+1);for(let i=0;i<m;i++)stack.pop();let comparisons=0;for(const item of [m,n,size]){comparisons++;if(item===size)break;}let loops=0;for(let i=0;i<n;i++)for(let j=0;j<m;j++)loops++;return[range(size).length,'o(1)',loops,'очередь',stack.at(-1),comparisons];}
 case 'Algorithms-Middle':{let x=1,count=0;while(x<n*m){x*=2;count++;}let distance=0;while(distance<n)distance++;return[range(n).flatMap(()=>range(10)).length,'o(log n)',range(n).length+range(m).length,'set',count,distance];}
 case 'Algorithms-Senior':{let cache=[],cost=0;for(const k of ['A','B','A','C','B']){const i=cache.indexOf(k);if(i<0){cost+=n;if(cache.length===2)cache.shift();}else cache.splice(i,1);cache.push(k);}return['идемпотентность',n*100-m*10,'backpressure','единый глобальный',n+n*100-m*10,cost];}
 case 'TypeScript-Junior':{const a=Array(n).fill(0),b=[...a,m];return[[n,n+1,n+2,n+3].filter(x=>x>n+m%3).length,[n,m].reduce((s,x)=>s+x,0),'void',n%m,[n,m,size].map(x=>x*2).reduce((s,x)=>s+x,0),a.length+b.length];}
 case 'TypeScript-Middle':{const x=0,v=String(n);return['unknown','typeof',[n].length,'as const',(x??n)+(x||m),typeof v==='string'?v.length:v+m];}
 case 'TypeScript-Senior':{const f=x=>x.kind==='add'?x.v+m:x.v*m,data={items:[]};return['never','discriminated union','satisfies','нет',f({kind:'mul',v:n}),(data.items?.length??n)+(data.items?.length||m)];}
 case 'React-Junior':{let queued=n;queued=n+m;queued=n+m;let functional=n;for(const updater of [c=>c+m,c=>c+m])functional=updater(functional);return['usestate','onclick','нет','props',queued,functional];}
 case 'React-Middle':return['key','useeffect',[c=>c+m,c=>c+m].reduce((c,f)=>f(c),n),'useref',[()=>n+m,c=>c*2].reduce((c,f)=>f(c),n),size];
 case 'React-Senior':{let state,latest=n+1;for(const response of [{id:n+1,value:m},{id:n,value:size}])if(response.id===latest)state=response.value;let cleanups=0,prev='initial';for(const id of [...Array(n).fill('initial'),...range(m).map(i=>'new-'+i)]){if(id!==prev)cleanups++;prev=id;}return['проверка request id','useeffect','виртуализация','да',state,cleanups];}
 case 'CSS-Junior':return[n*(m+10)/n,'color',n*10+m+m,'flex',n*10+m+m+1+1,n*m];
 case 'CSS-Middle':return[(n*100+(n-1)*m-(n-1)*m)/n,'border-box','#card','wrap',n*10-m-m-1-1,(n*size*10+(n-1)*m-(n-1)*m)/n];
 case 'CSS-Senior':return['minmax(0, 1fr)','prefers-reduced-motion','opacity','contain',[n*2,n*m,n*5].sort((a,b)=>a-b)[1],(n*20+m-m)/2];
 case 'Accessibility-Junior':return['button','for','alt','да',`field-${n}`,range(n).length];
 case 'Accessibility-Middle':return['aria-label',0,'submit','нет',`оплатить ${n}`,range(n).length];
 case 'Accessibility-Senior':return['на вызвавший элемент','aria-live','да','нет',`open-${n}`,`first-${n}`];
 default:throw new Error(key);
 }
}
export function referenceFor(question,questions){
 const [skill,grade,family,indexText]=question.conceptId.split('-');const[n,m]=parameters(skill,grade,questions);const index=Number(indexText)+(family==='applied'?4:0);
 return {answer:String(referenceAnswers(skill,grade,n,m)[index]),rationale:family==='applied'?'Независимая трассировка операций из текста; см. reference-oracle.mjs.':'Авторская разметка определения или независимый расчёт; см. reference-oracle.mjs.',parameters:{n,m},demand:family==='applied'?'короткая трассировка/применение':'воспроизведение/распознавание'};
}
