// Reviewer diagnostic. Training uses labelled answer keys; inference uses public DTO only.
// No semantic solver, no held-out retuning, no production imports of this diagnostic.
import {makeQuestions,gradeAssessment,BLUEPRINT} from '../lib/assessment.mjs';
import {publicKey} from '../tests/fixtures/assessment-v5/fresh-oracle.mjs';
import {stripTest} from '../lib/domain.mjs';
const output=[];
for(const spec of Object.keys(BLUEPRINT))for(const grade of ['Junior','Middle','Senior']){
 const memory=new Map(),frequencies=new Map();
 const family=q=>q.text.split('\nДанные: ')[0];
 for(let seed=671000;seed<671500;seed++)for(const q of makeQuestions(spec,grade,seed)){
  memory.set(publicKey(q),q.answer);
  const k=family(q);if(!frequencies.has(k))frequencies.set(k,new Map());
  const f=frequencies.get(k);f.set(q.answer,(f.get(q.answer)||0)+1);
 }
 // Stable first-seen tie breaking; determined from training alone.
 const modes=new Map([...frequencies].map(([k,f])=>[k,[...f].sort((a,b)=>b[1]-a[1])[0][0]]));
 let exact=0,fallback=0;
 for(let seed=972000;seed<972300;seed++){
  const questions=makeQuestions(spec,grade,seed),dto=stripTest({questions}).questions;
  for(const mode of [false,true]){
   const answers=Object.fromEntries(dto.map(q=>[q.id,memory.get(publicKey(q))??(mode?modes.get(family(q)):'не знаю')??'не знаю']));
   const passed=gradeAssessment({specialization:spec,questions},answers).passed;
   if(mode)fallback+=passed;else exact+=passed;
  }
 }
 output.push({spec,grade,exact,fallback,total:300});
}
console.log(JSON.stringify(output,null,2));
