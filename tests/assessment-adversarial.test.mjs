import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {makeQuestions,gradeAssessment,answerMatches,BLUEPRINT,ASSESSMENT_VERSION} from '../lib/assessment.mjs';
import {freshState,actor,stripTest,upgradeState,rankCandidates} from '../lib/domain.mjs';
import {sqliteD1} from './helpers/sqlite-d1.mjs';
import {RealAccountsService} from '../lib/real-accounts.mjs';

const blueprints=Object.keys(BLUEPRINT).flatMap(specialization=>['Junior','Middle','Senior'].map(grade=>({specialization,grade})));
const firstBeforeOr=text=>text.match(/:\s*([^:]+?)\s+или\s+/)?.[1]||'не знаю';
// The second interval was not used to build the question bank. Both are still
// developer-authored checks, not an independent expert or psychometric holdout.
const seedSets=[[0,100],[900001,900101]];
test('Every new blueprint requires two applied tasks per skill and keeps public answer keys private',()=>{
  for(const {specialization,grade} of blueprints)for(let seed=0;seed<100;seed++){
    const questions=makeQuestions(specialization,grade,seed);assert.equal(questions.length,12);
    for(const skill of BLUEPRINT[specialization]){const block=questions.filter(q=>q.skill===skill);assert.equal(block.length,3);assert.equal(block.filter(q=>q.applied).length,2);}
    const dto=stripTest({specialization,grade,questions});
    for(const q of dto.questions){for(const hidden of ['answer','alternatives','conceptId','applied'])assert.equal(hidden in q,false);if(q.choices){assert.equal(new Set(q.choices).size,q.choices.length);assert.equal(q.choices.length,2);}}
    assert.equal(gradeAssessment({specialization,questions},Object.fromEntries(questions.map(q=>[q.id,q.answer]))).passed,true);
  }
});
test('First/last/longest-option and constant yes/no recipes cannot confirm categories in either seed interval',()=>{
  const recipes=[
    q=>/да\/нет/.test(q.text)?'да':firstBeforeOr(q.text),
    q=>/да\/нет/.test(q.text)?'нет':firstBeforeOr(q.text),
    q=>q.choices?.[0]||'не знаю',q=>q.choices?.at(-1)||'не знаю',
    q=>q.choices?.slice().sort((a,b)=>b.length-a.length)[0]||'не знаю',
    ()=> 'да',()=> 'нет',
    q=>q.choices?.[0]||q.text.match(/-?\d+/)?.[0]||'не знаю',
    q=>q.choices?.[0]||q.text.match(/-?\d+/g)?.at(-1)||'не знаю',
  ];
  for(const {specialization,grade} of blueprints)for(const [start,end] of seedSets)for(let seed=start;seed<end;seed++){
    const questions=makeQuestions(specialization,grade,seed),dto=stripTest({questions});
    for(const predict of recipes){const answers=Object.fromEntries(dto.questions.map(q=>[q.id,predict(q)]));assert.equal(gradeAssessment({specialization,questions},answers).passed,false,`${specialization}/${grade}/${seed}`);}
  }
});
test('Correct option positions are balanced by randomization for each choice concept',()=>{
  const counts=new Map();
  for(const {specialization,grade} of blueprints)for(let seed=0;seed<1000;seed++)for(const q of makeQuestions(specialization,grade,seed))if(q.choices){
    const position=q.choices.findIndex(value=>answerMatches(q,value));assert.ok(position>=0);const c=counts.get(q.conceptId)||[0,0];c[position]++;counts.set(q.conceptId,c);
  }
  for(const [id,count] of counts){assert.ok(count[0]>50&&count[1]>50,id);const share=count[0]/(count[0]+count[1]);assert.ok(share>.35&&share<.65,`${id}: ${share}`);}
});
test('All 4096 correctness masks retain 9/12 total and independent 2/3 skill gates',()=>{
  const specialization='Frontend',questions=makeQuestions(specialization,'Senior',900019);
  for(let mask=0;mask<4096;mask++){
    const counts=Object.fromEntries(BLUEPRINT[specialization].map(skill=>[skill,0]));
    const answers=Object.fromEntries(questions.map((q,i)=>{const correct=!!(mask&(1<<i));if(correct)counts[q.skill]++;return[q.id,correct?q.answer:'__wrong__'];}));
    const sum=Object.values(counts).reduce((a,b)=>a+b,0),result=gradeAssessment({specialization,questions},answers);
    assert.equal(result.passed,sum>=9&&Object.values(counts).every(n=>n>=2));assert.equal(result.score,Math.round(sum/12*100));
  }
});
test('Numeric answer equivalence is strict, finite and does not accept explanatory or executable text',()=>{
  const q={answer:'12',format:'number'};for(const value of ['12','12.0','12,00','+012',' 12 '])assert.equal(answerMatches(q,value),true);
  for(const value of ['12 px','12abc','12 or 13','0xC','1e1','Infinity','NaN','12; alert(1)',''])assert.equal(answerMatches(q,value),false);
  assert.equal(answerMatches({answer:'нет',format:'text',alternatives:['no']},' NO '),true);
});
test('Applied arithmetic uses independently computed reference traces over different seeds',()=>{
  for(let seed=910000;seed<910100;seed++)for(const {specialization,grade} of blueprints)for(const q of makeQuestions(specialization,grade,seed)){
    if(!q.applied)continue;
    assert.ok(q.text.length>35);assert.equal(q.choices,undefined);
    if(q.conceptId==='Python-Senior-applied-0'){const [,n,m]=q.text.match(/range\((\d+)\).*rotate\((\d+)\)/).map(Number);const a=Array.from({length:n},(_,i)=>i);for(let i=0;i<m;i++)a.unshift(a.pop());assert.equal(Number(q.answer),a[0]);}
    if(q.conceptId==='Python-Senior-applied-1'){const [,n,m]=q.text.match(/range\((\d+)\).*total \+= (\d+)\./).map(Number);let total=0;for(let i=0;i<n;i++){try{if(i%2===0)continue;total+=i;}finally{total+=m;}}assert.equal(Number(q.answer),total);}
    if(q.conceptId==='Algorithms-Senior-applied-1'){const n=Number(q.text.match(/стоит (\d+) мс/)[1]);const lru=[];let cost=0;for(const key of ['A','B','A','C','B']){const index=lru.indexOf(key);if(index<0){cost+=n;if(lru.length===2)lru.shift();}else lru.splice(index,1);lru.push(key);}assert.equal(Number(q.answer),cost);}
    if(q.conceptId==='Algorithms-Middle-applied-0'){const limit=Number(q.text.match(/x < (\d+)/)[1]);let x=1,count=0;while(x<limit){x*=2;count++;}assert.equal(Number(q.answer),count);}
  }
});
test('Migration withdraws stale evidence without changing grade, cooldown, history or deleting tests',()=>{
  const s=freshState(),u=actor(s,'demo-candidate');u.assessmentVersion=2;u.evidenceSource='assessment';u.grade='Senior';u.gradeChangedAt=123;
  u.attempts=[{id:'old',passed:true,grade:'Senior',score:100,assessmentVersion:2}];
  s.tests.push({id:'old-active',userId:u.id,assessmentVersion:2,createdAt:Date.now(),expiresAt:Date.now()+60000,questions:[]});
  upgradeState(s);assert.equal(u.categoryConfirmed,false);assert.equal(u.grade,'Senior');assert.equal(u.gradeChangedAt,123);assert.equal(u.attempts.length,1);assert.equal(s.tests.length,1);assert.ok(s.tests[0].invalidated);assert.equal(u.evidenceSource,'legacy_retest_required');assert.equal(u.assessmentVersion,ASSESSMENT_VERSION);assert.deepEqual(u.skills,[]);
  assert.ok(!rankCandidates(s,actor(s,'demo-employer'),{}).some(c=>c.id===u.id));const once=JSON.stringify(s);upgradeState(s);assert.equal(JSON.stringify(s),once);
});
test('Normalized repository masks old evidence and preserves historical rows through a later profile save',async()=>{
  const db=sqliteD1(),config={accountsEnabled:true,emailMode:'off',privacyNoticeUrl:'https://example.test/privacy',privacyNoticeVersion:'synthetic-v1'},service=new RealAccountsService(db,config),principal={issuer:'synthetic',subject:'test-user'};
  try{
    const account=await service.execute(principal,{action:'register',role:'candidate',name:'Synthetic test',email:'migration@example.test',dataConsent:true,privacyNoticeVersion:'synthetic-v1'});
    await db.prepare('UPDATE real_accounts SET email_verified_at=? WHERE id=?').bind(Date.now(),account.accountId).run();
    const {test:attempt}=await service.execute(principal,{action:'test-start',specialization:'Frontend',grade:'Senior'});
    const stored=await db.prepare('SELECT * FROM real_assessments WHERE id=?').bind(attempt.id).first(),questions=JSON.parse(stored.questions_json);
    await service.execute(principal,{action:'test-submit',testId:attempt.id,answers:Object.fromEntries(questions.map(q=>[q.id,q.answer]))});
    await db.prepare('UPDATE real_assessments SET version=2 WHERE id=?').bind(attempt.id).run();
    let result=await service.state(principal);assert.equal(result.user.categoryConfirmed,false);assert.equal(result.user.grade,'Senior');assert.equal(result.user.attempts.length,1);assert.equal(result.user.evidenceSource,'legacy_retest_required');
    await service.execute(principal,{action:'profile',consent:true,published:true,about:'Still my profile',experience:3});
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM real_assessments').first()).n,1);assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM real_skill_evidence').first()).n,4);
    result=await service.state(principal);assert.equal(result.user.categoryConfirmed,false);assert.equal(result.user.grade,'Senior');
    const next=await service.execute(principal,{action:'test-start',specialization:'Frontend',grade:'Senior'});assert.notEqual(next.test.id,attempt.id);assert.equal(next.test.assessmentVersion,ASSESSMENT_VERSION);
  }finally{db.close();}
});
test('UI consumes public structured choices and documents stale evidence',()=>{
  const ui=readFileSync(new URL('../app/workspace.tsx',import.meta.url),'utf8');assert.ok(ui.includes('q.choices.map'));assert.ok(ui.includes('Выберите ответ'));assert.ok(ui.includes('legacy_retest_required'));assert.ok(ui.includes('144 проектных шаблона'));assert.ok(!ui.includes('Предыдущий тест оценивал навыки общим баллом'));
});


test('Public question DTO conforms to OpenAPI including randomized choices',()=>{
  const api=JSON.parse(readFileSync(new URL('../docs/openapi.json',import.meta.url),'utf8')),schema=api.components.schemas.Question;
  for(const {specialization,grade}of blueprints)for(let seed=10;seed<30;seed++){
    const questions=makeQuestions(specialization,grade,seed),dto=stripTest({questions});
    for(const q of dto.questions){for(const key of Object.keys(q))assert.ok(key in schema.properties,key);for(const key of schema.required)assert.ok(key in q);if(q.choices){assert.equal(q.choices.length,2);assert.equal(q.choices.filter(choice=>answerMatches(questions.find(x=>x.id===q.id),choice)).length,1);}}
  }
});

test('An unfinished old normalized attempt is cancelled without a fabricated failed score',async()=>{
  const db=sqliteD1(),config={accountsEnabled:true,emailMode:'off',privacyNoticeUrl:'https://example.test/privacy',privacyNoticeVersion:'synthetic-v1'},service=new RealAccountsService(db,config),principal={issuer:'synthetic',subject:'unfinished-user'};
  try{
    const account=await service.execute(principal,{action:'register',role:'candidate',name:'Synthetic unfinished',email:'unfinished@example.test',dataConsent:true,privacyNoticeVersion:'synthetic-v1'});
    await db.prepare('UPDATE real_accounts SET email_verified_at=? WHERE id=?').bind(Date.now(),account.accountId).run();
    const {test:attempt}=await service.execute(principal,{action:'test-start',specialization:'Backend',grade:'Junior'});
    await db.prepare('UPDATE real_assessments SET version=2 WHERE id=?').bind(attempt.id).run();
    assert.equal((await service.state(principal)).test,undefined);
    await service.execute(principal,{action:'profile',consent:true,published:true});
    const history=(await service.state(principal)).user.attempts;
    assert.equal(history.length,1);assert.equal(history[0].score,null);assert.equal(history[0].stale,true);assert.ok(history[0].invalidated);
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM real_assessments').first()).n,1);
  }finally{db.close();}
});

test('v4 compares decimal answers exactly without IEEE-754 rounding false accepts',()=>{
  const q={answer:'12',format:'number'};for(const value of ['12','12.000','+00012,000'])assert.equal(answerMatches(q,value),true,value);
  for(const value of ['11.99999999999999999999999','12.00000000000000000000001','120000000000000000000000','NaN','Infinity','1.2e1'])assert.equal(answerMatches(q,value),false,value);
  assert.equal(answerMatches({answer:'0',format:'number'},'-000.000'),true);assert.equal(answerMatches({answer:'-2.5',format:'number'},'-002,5000'),true);
});
test('HTML identifiers preserve case while ordinary knowledge answers remain case-insensitive',()=>{
  for(const grade of ['Junior','Senior'])for(let seed=0;seed<20;seed++){
   const questions=makeQuestions('Frontend',grade,seed),ids=questions.filter(q=>q.caseSensitive);assert.ok(ids.length>=1);
   for(const q of ids){assert.equal(answerMatches(q,q.answer),true);assert.equal(answerMatches(q,q.answer.toUpperCase()),false);const dto=stripTest({questions:[q]}).questions[0];assert.equal(dto.caseSensitive,true);assert.equal(dto.answer,undefined);}
  }
  assert.equal(answerMatches({answer:'stopiteration',format:'text'},'StopIteration'),true);
});
