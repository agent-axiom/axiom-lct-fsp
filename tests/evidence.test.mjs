import {test} from 'node:test';
import assert from 'node:assert/strict';
import {freshState,actor,command,rankCandidates,view,upgradeState,stripTest} from '../lib/domain.mjs';
import {ASSESSMENT_VERSION} from '../lib/assessment.mjs';
import {publicAssessmentEvidence} from '../lib/evidence.mjs';

const now=Date.UTC(2026,9,5,16),candidate='demo-candidate';
function attempt(state,{specialization='Backend',grade='Middle',at=now,mode='pass'}={}){
  const {test}=command(state,candidate,{action:'test-start',specialization,grade},at),stored=state.tests.find(t=>t.id===test.id),counts={};
  const answers=Object.fromEntries(stored.questions.map(q=>{counts[q.skill]=(counts[q.skill]||0)+1;const correct=mode==='pass'||mode==='75'&&(q.skill==='Python'||counts[q.skill]<=2);return[q.id,correct?q.answer:'__wrong__'];}));
  const result=command(state,candidate,{action:'test-submit',testId:test.id,answers},at+1);return {test:stored,result};
}
function found(state){return rankCandidates(state,actor(state,'demo-employer'),{}).find(c=>c.id===candidate);}

test('Evidence uses the successful current attempt, not a newer failed attempt',()=>{
  const s=freshState(),first=attempt(s);attempt(s,{specialization:'Frontend',at:now+100,mode:'fail'});
  const e=found(s).evidence;assert.equal(e.status,'current');assert.equal(e.assessmentId,first.test.id);assert.equal(e.completedAt,now+1);assert.equal(e.specialization,'Backend');assert.equal(e.bankVersion,ASSESSMENT_VERSION);assert.equal(e.score,100);assert.equal(actor(s,candidate).attempts[0].passed,false);assert.ok(e.skills.every(x=>x.applied.correct===2&&x.knowledge.correct===1));
});
test('A later 75-point pass replaces the former best result without averaging rounded block scores',()=>{
  const s=freshState();attempt(s);const second=attempt(s,{at:now+100,mode:'75'}),e=found(s).evidence;
  assert.equal(second.result.passed,true);assert.equal(e.assessmentId,second.test.id);assert.equal(e.score,75);assert.equal(e.totalCorrect,9);assert.equal(e.totalQuestions,12);assert.deepEqual(e.skills.map(x=>x.score),[100,67,67,67]);
});
test('Successful specialization replacement never merges old skills',()=>{
  const s=freshState();attempt(s);attempt(s,{specialization:'Frontend',at:now+100});
  const e=found(s).evidence;assert.equal(e.specialization,'Frontend');assert.deepEqual(e.skills.map(x=>x.skill),['TypeScript','React','CSS','Accessibility']);
});
test('Initial synthetic fixtures have no fabricated attempt date, bank, or measured task counts',()=>{
  const e=found(freshState()).evidence;assert.equal(e.status,'synthetic');assert.equal(e.completedAt,null);assert.equal(e.bankVersion,null);assert.equal(e.assessmentId,null);assert.equal(e.score,null);assert.ok(e.skills.every(x=>x.correct===null&&x.total===null&&x.confirmed===false));
});
test('Pre-v0.5 successful demo records may resolve by a matching completed pass but do not invent type breakdowns',()=>{
  const s=freshState(),{test}=attempt(s);delete actor(s,candidate).currentAssessmentId;for(const q of test.questions)delete q.correct;
  const e=found(s).evidence;assert.equal(e.status,'current');assert.equal(e.completedAt,now+1);assert.ok(e.skills.every(x=>x.applied===null&&x.knowledge===null&&x.tasks===null));
});
test('Missing, wrong-owner, failed, unfinished, stale, or profile-mismatched records cannot create current proof',()=>{
  const mutations=[s=>{s.tests=[];},s=>{s.tests[0].userId='candidate-2';},s=>{s.tests[0].passed=false;},s=>{s.tests[0].completedAt=null;},s=>{s.tests[0].assessmentVersion=2;},s=>{s.tests[0].grade='Senior';},s=>{actor(s,candidate).currentAssessmentId='nonexistent';}];
  for(const mutate of mutations){const s=freshState();attempt(s);mutate(s);assert.equal(publicAssessmentEvidence(s,actor(s,candidate)).status,'unavailable');}
});
test('Malformed counts, duplicate skills and inconsistent totals fail closed',()=>{
  const mutations=[r=>{r[0].correct=4;},r=>{r[0].total=2;},r=>{r[0].score=99;},r=>{r[0].confirmed=false;},r=>{r[0].skill=r[1].skill;},r=>{r.pop();}];
  for(const mutate of mutations){const s=freshState();attempt(s);mutate(s.tests[0].competencyResults);assert.equal(publicAssessmentEvidence(s,actor(s,candidate)).status,'unavailable');}
  const s=freshState();attempt(s);s.tests[0].questions[0].correct=false;assert.equal(publicAssessmentEvidence(s,actor(s,candidate)).status,'unavailable');
});
test('Employer proof is a nested allowlist without questions, identities, submitted answers or history',()=>{
  const s=freshState(),{test}=attempt(s),u=actor(s,candidate);u.competencyResults[0].answer='PRIVATE_SENTINEL';test.competencyResults[1].questions=['PRIVATE_SENTINEL'];test.token='PRIVATE_SENTINEL';test.questions[0].text='PRIVATE_SENTINEL';test.questions[0].answer='PRIVATE_SENTINEL';test.questions[0].choices=['PRIVATE_SENTINEL'];u.issuer='PRIVATE_SENTINEL';
  const row=found(s),json=JSON.stringify(row);assert.equal(json.includes('PRIVATE_SENTINEL'),false);assert.equal('email'in row,false);assert.equal('contact'in row,false);assert.equal('attempts'in row,false);
  assert.deepEqual(Object.keys(row.competencyResults[0]).sort(),['confirmed','correct','score','skill','total']);
  assert.deepEqual(Object.keys(row.evidence.skills[0]).sort(),['applied','confirmed','correct','knowledge','score','skill','tasks','total']);
  for(const q of stripTest(test).questions)for(const key of ['correct','answer','alternatives','conceptId'])assert.equal(key in q,false);
});
test('A stale pass stays withdrawn after a new failure, preserving its private history',()=>{
  const s=freshState(),{test}=attempt(s);actor(s,candidate).assessmentVersion=2;test.assessmentVersion=2;upgradeState(s);attempt(s,{at:now+100,mode:'fail'});
  assert.equal(found(s),undefined);assert.equal(view(s,actor(s,candidate)).user.evidence.status,'stale');assert.equal(actor(s,candidate).grade,'Middle');assert.ok(actor(s,candidate).attempts.some(a=>a.id===test.id&&a.stale));
});
test('Unmeasured stack remains missing and opening proof never opens contact or changes state',()=>{
  const s=freshState();attempt(s);actor(s,candidate).about='Expert Kubernetes PostgreSQL';const before=JSON.stringify(s);
  const row=rankCandidates(s,actor(s,'demo-employer'),{need:'Backend Kubernetes PostgreSQL'}).find(x=>x.id===candidate);
  assert.deepEqual(row.missing,['Kubernetes','PostgreSQL']);assert.equal(row.evidence.status,'current');assert.equal(row.contact,undefined);assert.equal(JSON.stringify(s),before);
});


test('Individual completed task receipts expose only number, kind and points with consistent totals',()=>{
 const s=freshState(),{test}=attempt(s,{mode:'75'}),e=found(s).evidence;
 const numbers=[];for(const skill of e.skills){assert.equal(skill.tasks.length,3);assert.equal(skill.tasks.reduce((sum,t)=>sum+t.score,0),skill.correct);for(const task of skill.tasks){assert.deepEqual(Object.keys(task).sort(),['kind','maxScore','number','score']);assert.ok(task.number>=1&&task.number<=12);assert.equal(task.maxScore,1);const stored=test.questions[task.number-1];assert.equal(stored.skill,skill.skill);assert.equal(task.score,stored.correct?1:0);numbers.push(task.number);}}
 assert.equal(new Set(numbers).size,12);assert.equal(e.skills.flatMap(x=>x.tasks).filter(x=>x.score===0).length,3);
});
