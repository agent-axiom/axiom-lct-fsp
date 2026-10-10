import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {freshState,actor,rankCandidates,publicCandidate,command} from '../lib/domain.mjs';
import {parseRequirements,matchCandidate} from '../lib/matching.mjs';
import {historicalDemoAchievements,verifiedDemoAchievements} from '../lib/achievements.mjs';

test('unknown mandatory Rust is explicit, unverified, never a full match or bonus',()=>{
 const state=freshState(),candidate=actor(state,'candidate-6'),skills=[...candidate.skills];
 for(const clause of ['обязателен Rust','Rust обязателен','обязательно знание Rust','Rust required','must have Rust','обязателен Elixir','обязателен разговорный английский']) {
  const requirements=parseRequirements({need:`Backend Middle Python SQL, ${clause}`});
  assert.deepEqual(requirements.unverifiedRequirements,[clause]);
  const row=matchCandidate({...candidate,score:100},requirements);
  assert.equal(row.matchStatus,'unverified');assert.ok(row.match<100);assert.ok(row.relevance<100);
  assert.equal(row.achievement.bonus,0);assert.equal(row.achievement.eligibleCount,0);
  assert.ok(row.missing.some(item=>item.includes(clause)));
  assert.ok(row.reasons.some(item=>item.includes('Полное соответствие не подтверждено')));
  assert.ok(!row.reasons.some(item=>item.includes('совпала категория и все требования')));
 }
 assert.deepEqual(candidate.skills,skills);
 const results=rankCandidates(state,actor(state,'demo-employer'),{need:'Backend Middle Python SQL, обязателен Rust'});
 assert.ok(results.length);assert.ok(results.every(row=>row.match<100&&row.achievement.bonus===0&&row.unverifiedRequirements.includes('обязателен Rust')));
});
test('known mandatory, optional unknown and negated unknown do not become unsupported must-haves',()=>{
 for(const clause of ['Python обязателен','обязателен SQL','Rust не обязателен','не требуется Rust','Rust not required','необязательно Rust','optional Rust']){
  assert.deepEqual(parseRequirements({need:`Backend Middle; ${clause}`}).unverifiedRequirements,[],clause);
 }
 assert.deepEqual(parseRequirements({need:'Backend Middle; обязательны Python, Rust, Elixir'}).unverifiedRequirements,['Rust','Elixir']);
 assert.deepEqual(parseRequirements({need:'обязателен Python; желательно Rust'}).unverifiedRequirements,[]);
 const c=actor(freshState(),'candidate-6');assert.equal(matchCandidate(c,parseRequirements({need:'Backend Middle Python SQL'})).match,100);
});
test('negative and optional comma clauses do not inherit a previous mandatory skill',()=>{
 const candidate=actor(freshState(),'candidate-6');
 for(const clause of ['Rust не нужен','Rust необязателен','без Rust','Rust not needed','Rust not required','Rust is not required','Rust is not mandatory','не требуется Rust','не обязательно Rust','optional Rust','Rust будет плюсом']){
  const requirements=parseRequirements({need:`Backend Middle; обязателен Python, ${clause}`});
  assert.deepEqual(requirements.unverifiedRequirements,[],clause);
  const row=matchCandidate(candidate,requirements);assert.equal(row.match,100,clause);assert.ok(row.achievement.bonus>0,clause);
  const later=parseRequirements({need:`Backend Middle; обязателен Python, ${clause}, обязателен Elixir`});
  assert.deepEqual(later.unverifiedRequirements,['обязателен Elixir'],clause);
  assert.equal(matchCandidate(candidate,later).achievement.bonus,0,clause);
 }
 assert.deepEqual(parseRequirements({need:'Backend Middle; обязателен Python, Rust'}).unverifiedRequirements,['Rust']);
});
test('Middle achievement remains visible after a successful Senior assessment and is not bonus eligible',()=>{
 const state=freshState(),c=actor(state,'candidate-6'),original=structuredClone(c.fspAchievements);
 const {test:attempt}=command(state,c.id,{action:'test-start',specialization:'Backend',grade:'Senior'});
 const internal=state.tests.find(t=>t.id===attempt.id);
 const result=command(state,c.id,{action:'test-submit',testId:attempt.id,answers:Object.fromEntries(internal.questions.map(q=>[q.id,q.answer]))});
 assert.equal(result.passed,true);assert.equal(c.grade,'Senior');assert.deepEqual(c.fspAchievements,original);
 assert.equal(publicCandidate(c,false,state).fspAchievements[0].grade,'Middle');
 assert.deepEqual(verifiedDemoAchievements(c),[]);
 const rows=rankCandidates(state,actor(state,'demo-employer'),{need:'Backend Senior',fsp:true});
 const row=rows.find(item=>item.id===c.id);assert.ok(row);assert.equal(row.fspAchievements.length,1);assert.equal(row.achievement.bonus,0);assert.equal(row.achievement.eligibleCount,0);
 assert.equal(row.contact,undefined);assert.equal(row.fspAchievements[0].provenance,'synthetic_seed');
});
test('historical display still rejects untrusted records and redacts private fields',()=>{
 const c=actor(freshState(),'candidate-6');c.grade='Senior';c.fspAchievements[0].privateContact='hidden@example.test';
 assert.equal(historicalDemoAchievements(c).length,1);assert.equal(historicalDemoAchievements(c)[0].privateContact,undefined);
 for(const patch of [{verified:false},{provenance:'user_input'},{grade:'Bogus'},{points:NaN}])assert.deepEqual(historicalDemoAchievements({...c,fspAchievements:[{...c.fspAchievements[0],...patch}]}),[]);
 assert.deepEqual(historicalDemoAchievements({...c,fsp:false}),[]);
});

test('matching response fields are declared in the closed OpenAPI result contract',()=>{
 const api=JSON.parse(readFileSync(new URL('../docs/openapi.json',import.meta.url),'utf8'));
 const state=freshState(),requirements=parseRequirements({need:'обязателен Rust'});
 const rows=rankCandidates(state,actor(state,'demo-employer'),{need:'обязателен Rust'});
 const resultSchema=api.components.schemas.CandidateResult;
 assert.equal(resultSchema.additionalProperties,false);
 assert.ok(rows.length);
 for(const row of rows){
  for(const key of Object.keys(row))assert.ok(Object.hasOwn(resultSchema.properties,key),`Undocumented result field: ${key}`);
  assert.ok(resultSchema.properties.matchStatus.enum.includes(row.matchStatus));
  assert.deepEqual(row.unverifiedRequirements,['обязателен Rust']);
 }
 for(const key of Object.keys(requirements))assert.ok(Object.hasOwn(api.components.schemas.Requirements.properties,key),`Undocumented requirement field: ${key}`);
 assert.equal(resultSchema.properties.unverifiedRequirements.type,'array');
});
test('Rust-only UI summary includes unverified requirements in the scoring explanation',()=>{
 const source=readFileSync(new URL('../app/workspace.tsx',import.meta.url),'utf8');
 assert.ok(source.includes("requirements.unverifiedRequirements?.length?'распознанных условий нет; обязательные условия требуют ручной проверки'"));
 assert.ok(source.includes("requirements.minExperience!==null||requirements.unverifiedRequirements?.length?'Соответствие требованиям: 80% · тест: 20%.'"));
});
