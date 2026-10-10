// Frozen-seed, synthetic developer regression. Not a human/professional validity study.
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import * as before from '../tests/fixtures/assessment-v5/baseline-v4.mjs';
import * as after from '../lib/assessment.mjs';
import {stripTest} from '../lib/domain.mjs';
import {referenceFor} from '../tests/fixtures/assessment-quality/reference-oracle.mjs';
import {freshReference,publicKey} from '../tests/fixtures/assessment-v5/fresh-oracle.mjs';
import {legacyReferenceCache} from '../tests/fixtures/assessment-v5/legacy-reference.mjs';
const folder=new URL('../tests/fixtures/assessment-v5/',import.meta.url);
const protocol=JSON.parse(readFileSync(new URL('protocol.json',folder),'utf8'));
const hash=url=>createHash('sha256').update(readFileSync(url)).digest('hex');
const statistics=results=>{
 const scores=results.map(r=>r.score),p=results.filter(r=>r.passed).length,n=results.length;
 return {attempts:n,passes:p,passRate:p/n,minScore:Math.min(...scores),maxScore:Math.max(...scores),meanScore:scores.reduce((a,b)=>a+b,0)/n,unorderedPairPassFlipRate:n<2?0:2*p*(n-p)/(n*(n-1))};
};
function evaluate(source){
 const rows=[];let checkedLabels=0;
 for(const specialization of Object.keys(source.BLUEPRINT))for(const grade of ['Junior','Middle','Senior']){
  const legacy=source.ASSESSMENT_VERSION===4?null:legacyReferenceCache(specialization,grade);
  function labels(qs){return Object.fromEntries(qs.map(q=>{
   // Only the family routing uses private metadata; the fresh solver receives the public DTO.
   const pub=stripTest({questions:[q]}).questions[0];
   const label=source.ASSESSMENT_VERSION===4?referenceFor(q,qs).answer:q.conceptId.endsWith('-fresh-0')?freshReference(pub,grade):legacy.get(publicKey(pub));
   if(label===undefined)throw new Error(`Legacy cache miss: ${q.text}`);
   if(!source.answerMatches(q,label))throw new Error(`Oracle disagreement: ${q.text}; ${label}`);
   checkedLabels++;return[q.id,label];
  }));}
  const runs=Array.from({length:protocol.evaluationCount},(_,i)=>{
   const questions=source.makeQuestions(specialization,grade,protocol.evaluationStart+i);
   return {questions,labels:labels(questions),dto:stripTest({questions}).questions};
  });
  const first=source.BLUEPRINT[specialization][0];
  const plans={all:()=>true,none:()=>false,'missing-first-skill':q=>q.skill!==first,'all-applied':q=>q.applied,
   'applied-plus-knowledge-0':q=>q.applied||q.conceptId.endsWith('knowledge-0'),
   'applied-plus-knowledge-0-1':q=>q.applied||/knowledge-[01]$/.test(q.conceptId),
   'legacy-only':q=>!q.conceptId.includes('-fresh-'),
   'fresh-plus-knowledge':q=>!q.conceptId.includes('-applied-')};
  const profiles=Object.fromEntries(protocol.profiles.map(name=>[name,statistics(runs.map(run=>source.gradeAssessment({specialization,questions:run.questions},Object.fromEntries(run.questions.map(q=>[q.id,plans[name](q)?run.labels[q.id]:protocol.unknownAnswer])))))]));
  const memory=new Map(),memorization=[];let trained=0;
  for(const trainingAttempts of protocol.trainSizes){
   while(trained<trainingAttempts){const qs=source.makeQuestions(specialization,grade,protocol.trainStart+trained++),refs=labels(qs);for(const pub of stripTest({questions:qs}).questions)memory.set(publicKey(pub),refs[pub.id]);}
   let recognized=0,items=0;const results=runs.map(run=>{
    // Inference sees only public text, format and choices; no family/answer/skill lookup.
    const answers=Object.fromEntries(run.dto.map(pub=>{const key=publicKey(pub),known=memory.has(key);recognized+=Number(known);items++;return[pub.id,known?memory.get(key):protocol.unknownAnswer];}));
    return source.gradeAssessment({specialization,questions:run.questions},answers);
   });
   memorization.push({trainingAttempts,memorizedExactPrompts:memory.size,recognized,items,recognizedFraction:recognized/items,...statistics(results)});
  }
  const concepts=runs.map(r=>new Set(r.questions.map(q=>q.conceptId)));
  let minOverlap=12,maxOverlap=0,overlapSum=0,pairs=0;
  for(let i=0;i<concepts.length;i++)for(let j=i+1;j<concepts.length;j++){
   const count=[...concepts[i]].filter(c=>concepts[j].has(c)).length;minOverlap=Math.min(minOverlap,count);maxOverlap=Math.max(maxOverlap,count);overlapSum+=count;pairs++;
  }
  const perFamily=new Map(),texts=new Set();let occurrences=0;
  for(const run of runs)for(const q of run.questions){occurrences++;texts.add(publicKey(q));if(!q.conceptId.endsWith('-fresh-0'))continue;
   if(!perFamily.has(q.conceptId))perFamily.set(q.conceptId,{occurrences:0,texts:new Set(),answers:new Set()});
   const f=perFamily.get(q.conceptId);f.occurrences++;f.texts.add(publicKey(q));f.answers.add(run.labels[q.id]);
  }
  rows.push({specialization,grade,profiles,memorization,conceptOverlap:{comparisons:pairs,min:minOverlap,max:maxOverlap,mean:overlapSum/pairs},publicTextDiversity:{occurrences,distinct:texts.size,repeatedOccurrences:occurrences-texts.size},freshFamilies:[...perFamily].map(([conceptId,f])=>({conceptId,occurrences:f.occurrences,distinctTexts:f.texts.size,repeatedOccurrences:f.occurrences-f.texts.size,repetitionFraction:(f.occurrences-f.texts.size)/f.occurrences,distinctAnswers:f.answers.size}))});
 }
 return {assessmentVersion:source.ASSESSMENT_VERSION,checkedLabels,rows};
}
const result={schemaVersion:1,developmentIteration:2,seedReuse:'Same frozen development protocol reused after observing iteration-1 results; this is NOT a fresh holdout.',protocol,provenance:{baselineSHA256:hash(new URL('baseline-v4.mjs',folder)),currentSHA256:hash(new URL('../lib/assessment.mjs',import.meta.url)),freshSourceSHA256:hash(new URL('../lib/assessment-fresh.mjs',import.meta.url)),oracleSHA256:hash(new URL('fresh-oracle.mjs',folder)),protocolSHA256:hash(new URL('protocol.json',folder))},limitations:[
 'Developer-authored synthetic regression; no human response data, independent expert review, psychometric calibration, or professional grade validity.',
 'Fresh reference oracle authored from a frozen contract before reading the new generator. This is implementation independence, not independent conceptual validation.',
 'New seed interval holds out random parameters, not unseen concepts. No LLM resistance claim; neither an LLM nor an external solver is evaluated.',
 'Exact-prompt memorizer is given independently calculated training labels, representing an exposed/learned training bank; inference uses only public DTO fields.',
 'The all-pair flip fraction measures only synthetic profile pass variation across these seeded forms. No test-retest improvement is assumed.',
 'All forms retain the same four fresh concepts per category. Text diversity is not concept diversity. Short traces do not establish professional competence.'
 ],before:evaluate(before),after:evaluate(after)};
writeFileSync(new URL('evaluation-results.json',folder),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({before:result.before.rows.map(r=>({category:r.specialization+' '+r.grade,memorizer500:r.memorization.at(-1),profiles:r.profiles})),after:result.after.rows.map(r=>({category:r.specialization+' '+r.grade,memorizer500:r.memorization.at(-1),profiles:r.profiles,freshFamilies:r.freshFamilies,conceptOverlap:r.conceptOverlap}))},null,2));
