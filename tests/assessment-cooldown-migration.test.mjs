import test from 'node:test';
import assert from 'node:assert/strict';
import {freshState,actor,command,upgradeState,INTERVAL} from '../lib/domain.mjs';
import {sqliteD1} from './helpers/sqlite-d1.mjs';
import {RealAccountsService} from '../lib/real-accounts.mjs';
const now=Date.UTC(2026,9,10,21,0),old=now-INTERVAL-1;
for(const [name,grade,pass] of [['same grade','Junior',true],['failed change','Middle',false],['successful change','Middle',true]]){
 test(`v4 stale persisted workspace: ${name} respects historical confirmation`,()=>{
  let state=freshState(),u=actor(state,'demo-candidate');
  Object.assign(u,{grade:'Junior',categoryConfirmed:true,assessmentVersion:4,evidenceSource:'assessment',gradeChangedAt:old,attempts:[{id:'historical',grade:'Junior',specialization:'Backend',passed:true,at:old,assessmentVersion:4}]});
  upgradeState(state);state=JSON.parse(JSON.stringify(state));u=actor(state,u.id);
  assert.equal(u.categoryConfirmed,false);
  const {test:t}=command(state,u.id,{action:'test-start',specialization:'Backend',grade},now);
  const stored=state.tests.find(x=>x.id===t.id);
  command(state,u.id,{action:'test-submit',testId:t.id,answers:Object.fromEntries(stored.questions.map(q=>[q.id,pass?q.answer:'не знаю']))},now+1000);
  const changed=pass&&grade!=='Junior';assert.equal(u.gradeChangedAt,changed?now+1000:old);assert.equal(u.grade,changed?'Middle':'Junior');assert.equal(u.attempts.find(a=>a.id==='historical').passed,true);
  if(changed){assert.throws(()=>command(state,u.id,{action:'test-start',specialization:'Backend',grade:'Senior'},now+2000),/90/);assert.doesNotThrow(()=>command(state,u.id,{action:'test-start',specialization:'Backend',grade:'Senior'},now+1000+INTERVAL));}
 });
 test(`v4 normalized SQLite reload: ${name} respects historical confirmation`,async()=>{
  const db=sqliteD1(),service=new RealAccountsService(db,{accountsEnabled:true,emailMode:'off',privacyNoticeUrl:'https://example.test/privacy',privacyNoticeVersion:'synthetic-v1'}),principal={issuer:'synthetic',subject:name};
  try{
   const account=await service.execute(principal,{action:'register',role:'candidate',name:'Synthetic migration',email:`${grade.toLowerCase()}-${pass}@example.test`,dataConsent:true,privacyNoticeVersion:'synthetic-v1'},old-1000);
   await db.prepare('UPDATE real_accounts SET email_verified_at=? WHERE id=?').bind(old,account.accountId).run();
   const {test:first}=await service.execute(principal,{action:'test-start',specialization:'Backend',grade:'Junior'},old);
   let row=await db.prepare('SELECT * FROM real_assessments WHERE id=?').bind(first.id).first();let qs=JSON.parse(row.questions_json);
   await service.execute(principal,{action:'test-submit',testId:first.id,answers:Object.fromEntries(qs.map(q=>[q.id,q.answer]))},old+1);
   await db.prepare('UPDATE real_assessments SET version=4 WHERE id=?').bind(first.id).run();
   await db.prepare('UPDATE real_candidate_profiles SET grade_changed_at=? WHERE account_id=?').bind(old,account.accountId).run();
   assert.equal((await service.state(principal)).user.categoryConfirmed,false);
   // A profile save persists stale category=false; history must still drive cooldown.
   await service.execute(principal,{action:'profile',consent:true,published:true,about:'Still historical'},now);
   const {test:t}=await service.execute(principal,{action:'test-start',specialization:'Backend',grade},now);
   row=await db.prepare('SELECT * FROM real_assessments WHERE id=?').bind(t.id).first();qs=JSON.parse(row.questions_json);
   await service.execute(principal,{action:'test-submit',testId:t.id,answers:Object.fromEntries(qs.map(q=>[q.id,pass?q.answer:'не знаю']))},now+1000);
   const user=(await service.state(principal)).user,changed=pass&&grade!=='Junior';
   assert.equal(user.gradeChangedAt,changed?now+1000:old);assert.equal(user.grade,changed?'Middle':'Junior');assert.equal(user.attempts.find(a=>a.id===first.id).passed,true);
   if(changed){await assert.rejects(service.execute(principal,{action:'test-start',specialization:'Backend',grade:'Senior'},now+2000),/90/);await assert.doesNotReject(service.execute(principal,{action:'test-start',specialization:'Backend',grade:'Senior'},now+1000+INTERVAL));}
  }finally{db.close();}
 });
}
