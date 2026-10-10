// Authored from family-contract.md before reading the v5 generator, 2026-10-10.
// Takes public text + skill + declared grade only. Never reads a generated answer.
export function freshReference(publicQuestion, grade) {
 const marker='\nДанные: ';
 const at=publicQuestion.text.lastIndexOf(marker);
 if(at<0)throw new Error('Missing final public data line');
 const d=JSON.parse(publicQuestion.text.slice(at+marker.length));
 const level=['Junior','Middle','Senior'].indexOf(grade);
 if(level<0)throw new Error('Unknown grade');
 let answer;
 const sum=xs=>xs.reduce((a,b)=>a+b,0);
 switch(publicQuestion.skill){
 case 'Python': {
  const retained=d.values.filter(x=>x>d.limit);
  answer=level===0?sum(retained):level===1?sum(retained.slice(1)):sum(retained)+d.values.length;break;
 }
 case 'SQL': {
  const groups=new Map();for(const row of d.rows){if(!groups.has(row.g))groups.set(row.g,[]);groups.get(row.g).push(row.x);}
  if(level===0)answer=sum(d.rows.filter(r=>r.x!==null&&r.x>d.limit).map(r=>r.x));
  else if(level===1)answer=[...groups.values()].filter(xs=>xs.some(x=>x!==null)&&sum(xs.filter(x=>x!==null))>d.limit).length;
  else answer=sum([...groups.values()].map(xs=>xs.length*sum(xs.filter(x=>x!==null))));break;
 }
 case 'HTTP':
  if(level===0)answer=new TextEncoder().encode(d.chunks.join('')).length;
  else if(level===1){const accepted=new Map();answer=0;for(const {window} of d.events){const n=accepted.get(window)||0;if(n===d.limit)answer++;else accepted.set(window,n+1);}}
  else {answer=d.version;for(const required of d.requests)if(required===answer)answer++;}break;
 case 'Algorithms':
  if(level===0){const found=d.values.indexOf(d.target);answer=found<0?d.values.length:found+1;}
  else if(level===1){const distance=Array(6).fill(Infinity);distance[0]=0;for(let round=0;round<6;round++)for(const [a,b]of d.edges){const da=distance[a],db=distance[b];distance[a]=Math.min(da,db+1);distance[b]=Math.min(db,da+1);}answer=Number.isFinite(distance[d.target])?distance[d.target]:-1;}
  else {const last=new Map();answer=0;d.keys.forEach((k,t)=>{if(!last.has(k)){answer++;if(last.size>=d.capacity){const oldest=[...last].sort((a,b)=>a[1]-b[1])[0][0];last.delete(oldest);}}last.set(k,t);});}break;
 case 'TypeScript':
  if(level===0)answer=sum(d.values.filter(x=>x>d.limit).map(x=>2*x));
  else if(level===1)answer=sum(d.values.map(x=>x===null?d.fallback:x));
  else {answer=d.initial;for(const op of d.ops)answer=op.kind==='add'?answer+op.v:answer*op.v;}break;
 case 'React':
  if(level===0)answer=d.values.length?d.initial+d.values.at(-1):d.initial;
  else if(level===1){answer=d.initial;for(const op of d.ops)answer=op.kind==='replace'?op.v:answer+op.v;}
  else {const matching=d.responses.filter(r=>r.id===d.latest);answer=matching.length?matching.at(-1).value:0;}break;
 case 'CSS':
  if(level===0)answer=sum(d.boxes.map(b=>b.width+2*(b.padding+b.border)));
  else if(level===1)answer=sum(d.tracks)+Math.max(0,d.tracks.length-1)*d.gap;
  else {const sorted=d.rules.map((r,i)=>({...r,i})).sort((a,b)=>a.specificity[0]-b.specificity[0]||a.specificity[1]-b.specificity[1]||a.specificity[2]-b.specificity[2]||a.i-b.i);answer=sorted.at(-1).value;}break;
 case 'Accessibility': {
  const eligible=d.elements.map((e,i)=>({...e,id:i+1})).filter(e=>!e.disabled&&e.tabindex>=0);
  if(level===0)answer=eligible.filter(e=>!e.hidden&&!e.inertAncestor).length;
  else if(level===1){eligible.sort((a,b)=>(a.tabindex||Infinity)-(b.tabindex||Infinity)||a.id-b.id);answer=eligible[d.steps-1]?.id??0;}
  else {const index=eligible.findIndex(e=>e.id===d.current);answer=eligible[((index+d.steps)%eligible.length+eligible.length)%eligible.length].id;}break;
 }
 default:throw new Error('Unknown skill');
 }
 return String(answer);
}
export const publicKey=q=>JSON.stringify([q.text,q.format,[...(q.choices||[])].sort()]);
