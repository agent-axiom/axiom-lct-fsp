import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
import {referenceFor} from './reference-oracle.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));
const afterFix=process.argv.includes('--after-fix');
const sourceArgument=process.argv.slice(2).find(arg=>!arg.startsWith('--'));
const root=path.resolve(sourceArgument||path.join(here,'baseline-source'));
const outputPrefix=afterFix?'after-fix-':'';
const source=await import(pathToFileURL(path.join(root,'lib/assessment.mjs')));
const domain=await import(pathToFileURL(path.join(root,'lib/domain.mjs')));
const {makeQuestions,gradeAssessment,answerMatches,BLUEPRINT,ASSESSMENT_VERSION}=source;
const {stripTest,freshState,actor,command,INTERVAL}=domain;
const corpus=JSON.parse(readFileSync(path.join(here,'reference-set.json'),'utf8'));
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const publicKey=q=>JSON.stringify([q.text,q.format,[...(q.choices||[])].sort()]);
const stat=()=>({attempts:0,passes:0,minScore:100,maxScore:0,totalScore:0});
const record=(s,r)=>{s.attempts++;s.passes+=Number(r.passed);s.minScore=Math.min(s.minScore,r.score);s.maxScore=Math.max(s.maxScore,r.score);s.totalScore+=r.score;};
const finish=s=>({...s,passRate:s.passes/s.attempts,meanScore:s.totalScore/s.attempts});
const referenceCheck={cases:corpus.cases.length,accepted:0,exactTextCases:0,reviewedEquivalentTextChanges:[],rejected:[],wrongAccepted:[],author:corpus.author,independence:corpus.independence};
for(const c of corpus.cases){const q=makeQuestions(c.specialization,c.grade,c.seed).find(q=>q.conceptId===c.id);if(!q){referenceCheck.rejected.push({id:c.id,reason:'missing source question'});continue;}
 const exactText=publicKey(q)===publicKey(c.publicQuestion);
 const reviewedEquivalent=afterFix&&c.id==='HTTP-Junior-knowledge-3'&&c.publicQuestion.text==='HTTP: код запроса без обязательной аутентификации?'&&q.text==='HTTP: какой статус означает, что запрос к защищённому ресурсу не содержит действительных учётных данных?'&&q.format==='number'&&c.expectedAnswer==='401'&&!q.choices;
 if(!exactText&&!reviewedEquivalent){referenceCheck.rejected.push({id:c.id,reason:'unreviewed source change'});continue;}
 if(exactText)referenceCheck.exactTextCases++;else referenceCheck.reviewedEquivalentTextChanges.push({id:c.id,before:c.publicQuestion.text,after:q.text,expectedAnswer:c.expectedAnswer,reviewer:'AI assessment reviewer',reason:'Уточнение неоднозначного условия 401 по RFC 9110; ответ и навык не изменены.'});
 if(answerMatches(q,c.expectedAnswer))referenceCheck.accepted++;else referenceCheck.rejected.push({id:c.id,answer:c.expectedAnswer});const wrong=q.format==='number'?String(Number(c.expectedAnswer)+1):'не знаю';if(answerMatches(q,wrong))referenceCheck.wrongAccepted.push(c.id);}
let checkedVariantAnswers=0;const keyDisagreements=[];const rows=[];
const responseCases=[];
for(const specialization of Object.keys(BLUEPRINT))for(const grade of ['Junior','Middle','Senior']){
 const concepts=new Set(),texts=new Set(),itemAnswerPairs=new Set(),textAnswers=new Map(),perConcept=new Map();
 let duplicateTextOccurrences=0,overlapSum=0,overlapMin=12,overlapMax=0,overlapCount=0,previous;
 const recipes={strong_reference:stat(),weak_no_answers:stat(),blind_first_choice:stat(),partial_all_applied_no_knowledge:stat(),partial_all_applied_one_knowledge_family:stat(),partial_all_applied_two_knowledge_families:stat(),partial_one_skill_missing:stat(),partial_one_skill_one_correct:stat(),borderline_3_2_2_2:stat(),borderline_2_2_2_2:stat()};
 for(let seed=303000;seed<303300;seed++){
  const questions=makeQuestions(specialization,grade,seed),test={specialization,questions},dto=stripTest({questions}).questions;
  const refs=Object.fromEntries(questions.map(q=>[q.id,referenceFor(q,questions).answer]));
  for(const q of questions){checkedVariantAnswers++;if(!answerMatches(q,refs[q.id]))keyDisagreements.push({specialization,grade,seed,id:q.conceptId,expected:refs[q.id]});for(const hidden of ['answer','alternatives','conceptId','applied'])assert.equal(hidden in dto.find(p=>p.id===q.id),false);
   concepts.add(q.conceptId);const key=publicKey(q);if(texts.has(key))duplicateTextOccurrences++;texts.add(key);itemAnswerPairs.add(key+'|'+refs[q.id]);if(!textAnswers.has(key))textAnswers.set(key,new Set());textAnswers.get(key).add(refs[q.id]);if(!perConcept.has(q.conceptId))perConcept.set(q.conceptId,{texts:new Set(),answers:new Set(),occurrences:0});const pc=perConcept.get(q.conceptId);pc.texts.add(key);pc.answers.add(refs[q.id]);pc.occurrences++;
  }
  const current=new Set(questions.map(q=>q.conceptId));if(previous){const overlap=[...current].filter(x=>previous.has(x)).length;overlapSum+=overlap;overlapMin=Math.min(overlapMin,overlap);overlapMax=Math.max(overlapMax,overlap);overlapCount++;}previous=current;
  const firstSkill=BLUEPRINT[specialization][0];const indexBySkill={};const index=new Map(questions.map(q=>[q.id,(indexBySkill[q.skill]=(indexBySkill[q.skill]??-1)+1)]));
  const plans={
   strong_reference:q=>refs[q.id],weak_no_answers:()=> 'не знаю',blind_first_choice:q=>q.choices?.[0]??'не знаю',
   partial_all_applied_no_knowledge:q=>q.applied?refs[q.id]:'не знаю',
   partial_all_applied_one_knowledge_family:q=>q.applied||q.conceptId.endsWith('knowledge-0')?refs[q.id]:'не знаю',
   partial_all_applied_two_knowledge_families:q=>q.applied||/knowledge-[01]$/.test(q.conceptId)?refs[q.id]:'не знаю',
   partial_one_skill_missing:q=>q.skill!==firstSkill?refs[q.id]:'не знаю',
   partial_one_skill_one_correct:q=>q.skill!==firstSkill||index.get(q.id)===0?refs[q.id]:'не знаю',
   borderline_3_2_2_2:q=>q.skill===firstSkill||index.get(q.id)<2?refs[q.id]:'не знаю',
   borderline_2_2_2_2:q=>index.get(q.id)<2?refs[q.id]:'не знаю'
  };
  for(const[name,fn]of Object.entries(plans)){const answers=Object.fromEntries(questions.map(q=>[q.id,fn(q)]));const result=gradeAssessment(test,answers);record(recipes[name],result);if(seed===303000)responseCases.push({id:`${specialization}-${grade}-${name}`,author:'AI assessment reviewer',specialization,grade,seed,archetype:name,expectedPassByAuthoredRubric:['strong_reference','borderline_3_2_2_2'].includes(name)?true:['partial_all_applied_one_knowledge_family','partial_all_applied_two_knowledge_families'].includes(name)?null:false,answers,observed:result});}
 }
 const memorization=[];
 for(const trainingAttempts of [1,5,20,100,500]){
  const memory=new Map();for(let seed=123000;seed<123000+trainingAttempts;seed++){const qs=makeQuestions(specialization,grade,seed);for(const q of qs)memory.set(publicKey(q),referenceFor(q,qs).answer);}
  const stats=stat();let recognized=0,items=0;
  for(let seed=303000;seed<303300;seed++){const questions=makeQuestions(specialization,grade,seed);const publicQuestions=stripTest({questions}).questions;const answers=Object.fromEntries(publicQuestions.map(q=>{const found=memory.get(publicKey(q));items++;recognized+=Number(found!==undefined);return[q.id,found??'не знаю'];}));record(stats,gradeAssessment({specialization,questions},answers));}
  memorization.push({trainingAttempts,memorizedExactPrompts:memory.size,recognized,items,...finish(stats)});
 }
 rows.push({specialization,grade,seedInterval:[303000,303300],variantCount:300,uniqueConcepts:concepts.size,totalQuestionOccurrences:3600,uniquePublicTexts:texts.size,uniqueTextAnswerPairs:itemAnswerPairs.size,duplicateTextOccurrences,textAnswerConflicts:[...textAnswers.values()].filter(s=>s.size>1).length,consecutiveConceptOverlap:{min:overlapMin,max:overlapMax,mean:overlapSum/overlapCount,comparisons:overlapCount},perConcept:[...perConcept].map(([id,v])=>({id,distinctTexts:v.texts.size,distinctAnswers:v.answers.size,occurrences:v.occurrences})),archetypes:Object.fromEntries(Object.entries(recipes).map(([k,v])=>[k,finish(v)])),memorization});
}
// Reproduce all correctness patterns separately from substantive validity.
const thresholds=[];
for(const specialization of Object.keys(BLUEPRINT))for(const grade of ['Junior','Middle','Senior']){const questions=makeQuestions(specialization,grade,303000),refs=Object.fromEntries(questions.map(q=>[q.id,referenceFor(q,questions).answer]));let mismatches=0,passes=0;const byTotal={};for(let mask=0;mask<4096;mask++){const counts=Object.fromEntries(BLUEPRINT[specialization].map(s=>[s,0]));const answers=Object.fromEntries(questions.map((q,i)=>{const yes=!!(mask&(1<<i));counts[q.skill]+=Number(yes);return[q.id,yes?refs[q.id]:'не знаю'];}));const total=Object.values(counts).reduce((a,b)=>a+b,0),expect=total>=9&&Object.values(counts).every(n=>n>=2);const result=gradeAssessment({specialization,questions},answers);if(result.passed!==expect)mismatches++;passes+=Number(result.passed);(byTotal[total]??={patterns:0,passes:0}).patterns++;byTotal[total].passes+=Number(result.passed);}thresholds.push({specialization,grade,patterns:4096,passes,mismatches,byTotal});}
// Do not confuse permissive/strict answer formatting with actual participant error rates.
const formatting=[
 {question:{answer:'12',format:'number'},submitted:'12.00',semanticLabel:true,formatLabel:true},
 {question:{answer:'12',format:'number'},submitted:'12,00',semanticLabel:true,formatLabel:true},
 {question:{answer:'12',format:'number'},submitted:'12 px',semanticLabel:true,formatLabel:false},
 {question:{answer:'12',format:'number'},submitted:'Ответ: 12',semanticLabel:true,formatLabel:false},
 {question:{answer:'12',format:'number'},submitted:'1.2e1',semanticLabel:true,formatLabel:false},
 {question:{answer:'12',format:'number'},submitted:'11.99999999999999999999999',semanticLabel:false,formatLabel:true},
 {question:{answer:'оплатить 9',format:'text'},submitted:'«Оплатить 9»',semanticLabel:true,formatLabel:false},
 {question:{answer:'stopiteration',format:'text'},submitted:'StopIteration',semanticLabel:true,formatLabel:true},
 {question:{answer:'stopiteration',format:'text'},submitted:'StopIteration.',semanticLabel:true,formatLabel:false},
 {question:{answer:'first-9',format:'text',...(ASSESSMENT_VERSION>=4?{caseSensitive:true}:{})},submitted:'FIRST-9',semanticLabel:false,formatLabel:false},
 {question:{answer:'first-9',format:'text',...(ASSESSMENT_VERSION>=4?{caseSensitive:true}:{})},submitted:'#first-9',semanticLabel:true,formatLabel:false},
 {question:{answer:'нет',alternatives:['no'],format:'text'},submitted:'NO',semanticLabel:true,formatLabel:true},
].map(c=>({...c,accepted:answerMatches(c.question,c.submitted),author:'AI assessment reviewer; semantic vs format labels are separate'}));
// Verify defects against real generated items, not just manufactured question objects.
const actualQuestions=makeQuestions('Frontend','Senior',303000);
const actualIdQuestion=actualQuestions.find(q=>q.conceptId==='Accessibility-Senior-applied-1');
const actualNumberQuestion=actualQuestions.find(q=>q.format==='number');
const idReference=referenceFor(actualIdQuestion,actualQuestions).answer;
const numberReference=referenceFor(actualNumberQuestion,actualQuestions).answer;
const actualSourceRegressions=[
 {conceptId:actualIdQuestion.conceptId,submitted:idReference,expected:true,accepted:answerMatches(actualIdQuestion,idReference)},
 {conceptId:actualIdQuestion.conceptId,submitted:idReference.toUpperCase(),expected:false,accepted:answerMatches(actualIdQuestion,idReference.toUpperCase())},
 {conceptId:actualNumberQuestion.conceptId,submitted:numberReference,expected:true,accepted:answerMatches(actualNumberQuestion,numberReference)},
 {conceptId:actualNumberQuestion.conceptId,submitted:(Number(numberReference)-1)+'.99999999999999999999999',expected:false,accepted:answerMatches(actualNumberQuestion,(Number(numberReference)-1)+'.99999999999999999999999')},
 {conceptId:actualNumberQuestion.conceptId,submitted:numberReference+'.00000000000000000000001',expected:false,accepted:answerMatches(actualNumberQuestion,numberReference+'.00000000000000000000001')},
];
if(afterFix)for(const check of actualSourceRegressions)assert.equal(check.accepted,check.expected,check.conceptId+' '+check.submitted);
// In-memory policy observation; no accounts, database, provider or external mutations.
const state=freshState(),u=actor(state,'demo-candidate'),now=1791300000000;
u.categoryConfirmed=false;u.grade='Junior';u.gradeChangedAt=null;u.attempts=[];u.currentAssessmentId=null;
function runGrade(grade,at,correct=true,specialization='Backend'){const started=command(state,u.id,{action:'test-start',specialization,grade},at);const test=state.tests.find(t=>t.id===started.test.id);const answers=Object.fromEntries(test.questions.map(q=>[q.id,correct?referenceFor(q,test.questions).answer:'не знаю']));return command(state,u.id,{action:'test-submit',testId:test.id,answers},at+1);}
const policy=[];
runGrade('Middle',now);policy.push({case:'initial_success',grade:u.grade,gradeChangedAt:u.gradeChangedAt});assert.equal(u.gradeChangedAt,null);
runGrade('Senior',now+1000);const change=u.gradeChangedAt;policy.push({case:'successful_change_after_confirmation',grade:u.grade,gradeChangedAt:change});assert.equal(change,now+1001);
runGrade('Senior',now+2000,false);policy.push({case:'failed_same_grade_preserves_grade_and_clock',grade:u.grade,gradeChangedAt:u.gradeChangedAt});assert.equal(u.grade,'Senior');assert.equal(u.gradeChangedAt,change);
try{command(state,u.id,{action:'test-start',specialization:'Backend',grade:'Middle'},change+INTERVAL-1);throw new Error('Cooldown was bypassed');}catch(e){if(!e.message.includes('90'))throw e;policy.push({case:'different_grade_one_ms_before_90_days',blocked:true});}
runGrade('Middle',change+INTERVAL);policy.push({case:'different_grade_at_90_days',grade:u.grade,gradeChangedAt:u.gradeChangedAt});assert.equal(u.grade,'Middle');
const result={schemaVersion:1,evaluationMode:afterFix?'after-fix':'baseline',runAt:new Date().toISOString(),assessmentVersion:ASSESSMENT_VERSION,sourcePath:path.relative(here,root),sourceSHA256:hash(path.join(root,'lib/assessment.mjs')),corpusSHA256:hash(path.join(here,'reference-set.json')),originalEvaluatorSHA256:hash(path.join(root,'scripts/evaluate-assessment.mjs')),limitations:['Автор — AI-рецензент после чтения исходника, не независимая экспертная панель.','Все кандидаты и ответы синтетические; реальные люди, прокторинг, психометрическая калибровка и измерение качества найма отсутствуют.','Повторы seeds коррелированы. 144 шаблона и 108000 исходных recipe evaluations не являются независимой валидацией.','Memorization предполагает полученные ответы к учебному банку (например, утечка/совместная подготовка); не утверждает, что API раскрывает ключи.','Public DTO privacy — узкая проверка перечисленных полей; bundle/network/identity attacks здесь не проверялись.'],referenceCheck,checkedVariantAnswers,keyDisagreements,rows,thresholds,formatting,actualSourceRegressions,policy};
writeFileSync(path.join(here,outputPrefix+'quality-results.json'),JSON.stringify(result,null,2)+'\n');
writeFileSync(path.join(here,outputPrefix+'response-cases.json'),JSON.stringify({author:'AI assessment reviewer',count:responseCases.length,limitations:result.limitations,cases:responseCases},null,2)+'\n');
console.log(JSON.stringify({referenceCases:referenceCheck.cases,acceptedReferences:referenceCheck.accepted,keyDisagreements:keyDisagreements.length,checkedVariantAnswers,thresholdPatterns:thresholds.reduce((n,r)=>n+r.patterns,0),thresholdMismatches:thresholds.reduce((n,r)=>n+r.mismatches,0),rows:rows.map(r=>({specialization:r.specialization,grade:r.grade,uniqueTexts:r.uniquePublicTexts,overlap:r.consecutiveConceptOverlap,memorization:r.memorization.map(m=>({train:m.trainingAttempts,passes:m.passes,total:m.attempts,mean:m.meanScore})),partialOneKnowledge:r.archetypes.partial_all_applied_one_knowledge_family})),formatting,actualSourceRegressions,policy},null,2));
if(referenceCheck.accepted!==referenceCheck.cases||referenceCheck.wrongAccepted.length||keyDisagreements.length||thresholds.some(r=>r.mismatches))process.exitCode=1;
