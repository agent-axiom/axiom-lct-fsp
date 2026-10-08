import {test} from 'node:test';import assert from 'node:assert/strict';
import {sqliteD1} from './helpers/sqlite-d1.mjs';
import {RealAccountsService,realAccountsConfiguration} from '../lib/real-accounts.mjs';
import {challengeToken,drainEmailOutbox} from '../lib/email-outbox.mjs';
const principal=name=>({issuer:'synthetic-test-issuer',subject:name});
const config={accountsEnabled:true,emailMode:'off',tokenSecret:'Synthetic-test-only-HMAC-material-0123456789',privacyNoticeUrl:'https://example.test/privacy',privacyNoticeVersion:'test-v1',resendApiKey:'synthetic-test-not-a-credential',sender:'verify@example.test',siteOrigin:'https://example.test'};
const registration=(name,role='candidate')=>({action:'register',role,name,email:`${name}@example.test`,dataConsent:true,privacyNoticeVersion:'test-v1'});
function fixture(options={}){const db=sqliteD1(),settings={...config,...options},service=new RealAccountsService(db,settings);return {db,service,settings};}
async function enrolled(f,name,role='candidate',now=Date.now()){return f.service.execute(principal(name),registration(name,role),now);}
async function verify(f,name,now=Date.now()){
  const account=await f.db.prepare('SELECT * FROM real_accounts WHERE subject=?').bind(name).first();const challenge=await f.db.prepare('SELECT * FROM real_email_challenges WHERE account_id=? ORDER BY created_at DESC LIMIT 1').bind(account.id).first();
  await drainEmailOutbox(f.db,{...f.settings,emailMode:'live'},{now,fetcher:async()=>({ok:true,status:200,json:async()=>({id:'synthetic-mail-id'})})});
  return f.service.execute(principal(name),{action:'email-verify',challengeId:challenge.id,token:await challengeToken(f.settings.tokenSecret,challenge)},now+1);
}
test('real accounts and mail default off; no account data is created by status reads',async()=>{const f=fixture(realAccountsConfiguration({}));try{assert.deepEqual(await f.service.state(principal('alice')),{enabled:false,emailEnabled:false,message:'Реальные аккаунты и внешняя почта готовятся; публичная демонстрация работает отдельно.'});await assert.rejects(f.service.execute(principal('alice'),registration('alice')),/не активированы/);assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM real_accounts').first()).n,0);}finally{f.db.close();}});
test('real-data policy approval is required in configuration and registration',async()=>{const f=fixture({privacyNoticeVersion:''});try{await assert.rejects(enrolled(f,'alice'),/политика/);}finally{f.db.close();}const g=fixture();try{await assert.rejects(g.service.execute(principal('alice'),{...registration('alice'),dataConsent:false}),/политику/);await assert.rejects(g.service.execute(principal('alice'),{...registration('alice'),privacyNoticeVersion:'old'}),/политику/);}finally{g.db.close();}});
test('signup atomically writes account, role profile, challenge hash and blocked outbox',async()=>{const f=fixture();try{const r=await enrolled(f,'alice');assert.equal(r.emailStatus,'blocked');const account=await f.db.prepare('SELECT * FROM real_accounts WHERE id=?').bind(r.accountId).first();assert.equal(account.role,'candidate');assert.ok(account.privacy_accepted_at);assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM real_candidate_profiles').first()).n,1);assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM real_email_challenges').first()).n,1);const challenge=await f.db.prepare('SELECT * FROM real_email_challenges').first();assert.ok(!JSON.stringify(challenge).includes(await challengeToken(config.tokenSecret,challenge)));assert.equal((await f.db.prepare('SELECT * FROM real_email_outbox').first()).status,'blocked');}finally{f.db.close();}});
test('outbox insert failure rolls back entire registration including revision',async()=>{const f=fixture();try{f.db.failOnceWhen=/INSERT INTO real_email_outbox/;await assert.rejects(enrolled(f,'alice'),/Injected/);for(const table of ['real_accounts','real_candidate_profiles','real_email_challenges','real_email_outbox'])assert.equal((await f.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first()).n,0);assert.equal((await f.db.prepare("SELECT revision FROM real_revisions WHERE id='main'").first()).revision,0);}finally{f.db.close();}});
test('identity and email uniqueness are database enforced; enrollment cannot switch role',async()=>{const f=fixture();try{const first=await enrolled(f,'alice');const second=await f.service.execute(principal('alice'),{...registration('newname','employer')});assert.equal(second.accountId,first.accountId);assert.equal(second.role,'candidate');await assert.rejects(f.service.execute(principal('other'),registration('alice')),/недоступен/);await assert.rejects(f.service.execute(principal('alice'),{action:'switch',id:'other'}),/недоступно/);}finally{f.db.close();}});
test('unverified account cannot start tests or search and cannot see other account switcher',async()=>{const f=fixture();try{await enrolled(f,'alice');await enrolled(f,'company','employer');await assert.rejects(f.service.execute(principal('alice'),{action:'test-start',specialization:'Backend',grade:'Junior'}),/подтвердите/);await assert.rejects(f.service.execute(principal('company'),{action:'search'}),/подтвердите/);const state=await f.service.state(principal('company'));assert.equal(state.accounts.length,1);assert.equal(state.accounts[0].role,'employer');assert.deepEqual(state.outbox,[]);assert.equal(JSON.stringify(state).includes('alice@example.test'),false);}finally{f.db.close();}});
test('email verification is recipient-bound, single-use, and grants only stored role',async()=>{const f=fixture({emailMode:'live'});try{const now=Date.now();await enrolled(f,'alice','candidate',now);await enrolled(f,'company','employer',now);assert.equal((await verify(f,'alice',now+1)).emailStatus,'verified');const account=await f.db.prepare("SELECT * FROM real_accounts WHERE subject='alice'").first();assert.ok(account.email_verified_at);const challenge=await f.db.prepare('SELECT * FROM real_email_challenges WHERE account_id=?').bind(account.id).first();await assert.rejects(f.service.execute(principal('company'),{action:'email-verify',challengeId:challenge.id,token:await challengeToken(config.tokenSecret,challenge)},now+3),/недоступна/);await assert.rejects(f.service.execute(principal('alice'),{action:'email-verify',challengeId:challenge.id,token:await challengeToken(config.tokenSecret,challenge)},now+3),/недоступна/);await assert.rejects(f.service.execute(principal('alice'),{action:'search',role:'employer'}),/Нет доступа/);}finally{f.db.close();}});
test('failed email token attempts persist despite rejected verification',async()=>{const f=fixture({emailMode:'live'});try{const now=Date.now();await enrolled(f,'alice','candidate',now);await drainEmailOutbox(f.db,f.settings,{now:now+1,fetcher:async()=>({ok:true,json:async()=>({id:'fake'})})});const challenge=await f.db.prepare('SELECT * FROM real_email_challenges').first();for(let i=0;i<5;i++){const r=await f.service.execute(principal('alice'),{action:'email-verify',challengeId:challenge.id,token:'wrong'},now+2);assert.ok(r.verificationError);}assert.equal((await f.db.prepare('SELECT failed_attempts FROM real_email_challenges').first()).failed_attempts,5);await assert.rejects(f.service.execute(principal('alice'),{action:'email-verify',challengeId:challenge.id,token:await challengeToken(config.tokenSecret,challenge)},now+3),/недоступна/);}finally{f.db.close();}});
test('normalized hiring scenario persists evidence and exposes contact only after acceptance',async()=>{const f=fixture({emailMode:'live'});try{const now=Date.now();const candidate=await enrolled(f,'alice','candidate',now);const employer=await enrolled(f,'company','employer',now);await verify(f,'alice',now+1);await verify(f,'company',now+2);await f.service.execute(principal('alice'),{action:'profile',consent:true,published:true,about:'Synthetic profile',experience:2,softSkills:'Teamwork',contact:'injected@example.test',id:employer.accountId});const started=await f.service.execute(principal('alice'),{action:'test-start',specialization:'Backend',grade:'Junior'});assert.ok(started.test.questions.every(q=>!q.answer&&!q.alternatives));const test=await f.db.prepare('SELECT * FROM real_assessments WHERE id=?').bind(started.test.id).first();const questions=JSON.parse(test.questions_json);const result=await f.service.execute(principal('alice'),{action:'test-submit',testId:test.id,answers:Object.fromEntries(questions.map(q=>[q.id,q.answer]))});assert.equal(result.passed,true);assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM real_skill_evidence WHERE account_id=?').bind(candidate.accountId).first()).n,4);const found=await f.service.execute(principal('company'),{action:'search',need:'Junior Backend Python SQL'});assert.equal(found.candidates.length,1);assert.equal(found.candidates[0].contact,undefined);const invitation=(await f.service.execute(principal('company'),{action:'invite',candidateId:candidate.accountId,salaryFrom:100000,salaryTo:150000,salaryBasis:'net',description:'Synthetic offer for the backend role'})).invitation;assert.equal(invitation.salaryBasis,'net');assert.equal((await f.service.state(principal('company'))).invitations[0].salaryBasis,'net');await f.service.execute(principal('alice'),{action:'invitation-status',id:invitation.id,status:'accepted'});assert.equal((await f.service.execute(principal('company'),{action:'search'})).candidates[0].contact,'alice@example.test');await f.service.execute(principal('alice'),{action:'profile',consent:false,published:false});assert.equal((await f.service.state(principal('company'))).invitations[0].candidateContact,undefined);}finally{f.db.close();}});
test('repository stale CAS cannot overwrite another committed account profile',async()=>{const f=fixture();try{await enrolled(f,'alice');const left=await f.service.repository.snapshot(),right=await f.service.repository.snapshot();left.state.users[0].about='left';right.state.users[0].about='right';await f.service.repository.save(left,left.state);await assert.rejects(f.service.repository.save(right,right.state),error=>error.status===409);assert.equal((await f.service.repository.snapshot()).state.users[0].about,'left');}finally{f.db.close();}});
test('email rate limits operate on normalized database records',async()=>{const f=fixture();try{const now=Date.now();await enrolled(f,'alice','candidate',now);await assert.rejects(f.service.execute(principal('alice'),{action:'email-request'},now+1),error=>error.status===429);for(let i=1;i<5;i++)await f.service.execute(principal('alice'),{action:'email-request'},now+i*60000);await assert.rejects(f.service.execute(principal('alice'),{action:'email-request'},now+5*60000),error=>error.status===429);}finally{f.db.close();}});
test('scoped reads exclude unrelated unpublished accounts and use actual query indexes',async()=>{const f=fixture();try{await enrolled(f,'alice');await enrolled(f,'bob');await enrolled(f,'company','employer');const view=await f.service.repository.snapshot(principal('alice'));assert.deepEqual(view.state.users.map(u=>u.email),['alice@example.test']);const employer=await f.service.repository.snapshot(principal('company'));assert.deepEqual(employer.state.users.map(u=>u.email),['company@example.test']);const plan=await f.db.prepare("EXPLAIN QUERY PLAN SELECT * FROM real_candidate_profiles WHERE published=1 AND consent=1 AND category_confirmed=1").all();assert.ok(plan.results.some(row=>row.detail.includes('real_candidates_visibility')));}finally{f.db.close();}});

const invalidLiveSettings=[
  ['missing API key',{resendApiKey:''}],
  ['blank sender',{sender:'   '}],
  ['missing token secret',{tokenSecret:''}],
  ['short token secret',{tokenSecret:'too-short'}],
  ['blank token secret',{tokenSecret:' '.repeat(32)}],
  ['missing origin',{siteOrigin:''}],
  ['malformed origin',{siteOrigin:'not-a-url'}],
  ['HTTP origin',{siteOrigin:'http://example.test'}],
  ['origin with path',{siteOrigin:'https://example.test/account'}],
  ['origin with query',{siteOrigin:'https://example.test/?query=1'}],
  ['origin with fragment',{siteOrigin:'https://example.test/#fragment'}],
  ['origin with credentials',{siteOrigin:'https://synthetic:unused@example.test'}],
];
for(const [label,override] of invalidLiveSettings){
  test(`live enrollment fails before writing account or email records: ${label}`,async()=>{
    const f=fixture({emailMode:'live',...override});
    try{
      await assert.rejects(enrolled(f,'alice'),error=>error.status===503);
      for(const table of ['real_accounts','real_candidate_profiles','real_email_challenges','real_email_outbox'])assert.equal((await f.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first()).n,0);
      assert.equal((await f.db.prepare("SELECT revision FROM real_revisions WHERE id='main'").first()).revision,0);
    }finally{f.db.close();}
  });
  test(`live resend fails without changing existing records: ${label}`,async()=>{
    const f=fixture({emailMode:'live'}),now=Date.now();
    try{
      await enrolled(f,'alice','candidate',now);
      const before=await f.db.prepare("SELECT revision FROM real_revisions WHERE id='main'").first();
      Object.assign(f.settings,override);
      await assert.rejects(f.service.execute(principal('alice'),{action:'email-request'},now+60000),error=>error.status===503);
      for(const table of ['real_email_challenges','real_email_outbox'])assert.equal((await f.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first()).n,1);
      assert.equal((await f.db.prepare("SELECT revision FROM real_revisions WHERE id='main'").first()).revision,before.revision);
    }finally{f.db.close();}
  });
}
test('OFF enrollment still works without delivery configuration and creates no email job without a token secret',async()=>{
  const f=fixture({resendApiKey:'',sender:'',siteOrigin:'',tokenSecret:''});
  try{
    assert.equal((await enrolled(f,'alice')).emailStatus,'not_configured');
    assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM real_accounts').first()).n,1);
    assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM real_email_outbox').first()).n,0);
  }finally{f.db.close();}
});
test('an email configuration outage does not block existing verified account state or role actions',async()=>{
  const f=fixture({emailMode:'live'}),now=Date.now();
  try{
    await enrolled(f,'company','employer',now);await verify(f,'company',now+1);
    Object.assign(f.settings,{resendApiKey:'',sender:'',siteOrigin:'',tokenSecret:''});
    assert.equal((await f.service.state(principal('company'))).user.verified,true);
    assert.equal((await f.service.execute(principal('company'),{action:'company',company:'Synthetic company'})).ok,true);
    assert.equal((await f.service.execute(principal('company'),{action:'email-request'})).emailStatus,'verified');
  }finally{f.db.close();}
});
