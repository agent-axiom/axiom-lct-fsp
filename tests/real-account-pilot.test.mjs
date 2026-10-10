import {test} from 'node:test';
import assert from 'node:assert/strict';
import {handleAccountRequest} from '../lib/real-account-http.mjs';
import {realAccountsConfiguration} from '../lib/real-accounts.mjs';
import {sqliteD1} from './helpers/sqlite-d1.mjs';

// Synthetic fixtures only. The transport is injected; no network or provider call.
const origin='https://pilot.example.test';
const principal=subject=>({issuer:'sites-chatgpt',subject});
const base={accountsEnabled:true,emailMode:'live',emailTransport:'resend',
 tokenSecret:'Synthetic-test-only-HMAC-material-0123456789',resendApiKey:'synthetic-test-not-a-credential',
 sender:'noreply@notify.example.test',siteOrigin:origin,
 privacyNoticeUrl:origin+'/privacy',privacyNoticeVersion:'synthetic-v1',
 pilotSubjects:JSON.stringify(['candidate','employer','outsider-employer'])};
const signup=(subject,role)=>({action:'register',role,name:`Synthetic ${subject}`,email:`${subject}@example.test`,dataConsent:true,privacyNoticeVersion:'synthetic-v1'});
function fixture(config=base){
 const db=sqliteD1(),mail=[];let now=Date.now();
 const emailFetcher=async(url,options)=>{assert.equal(url,'https://api.resend.com/emails');assert.equal(options.method,'POST');const payload=JSON.parse(options.body);mail.push(payload);return Response.json({id:`fake-mail-${mail.length}`});};
 const call=async(subject,input,path='/api/account/action',headers={})=>{
  const request=new Request(origin+path,input?{method:'POST',headers:{origin,'Content-Type':'application/json',...headers},body:JSON.stringify(input)}:{headers});
  const response=await handleAccountRequest(request,{principal:subject?principal(subject):null,db,config,emailFetcher,clock:()=>now});
  return {status:response.status,body:await response.json()};
 };
 const state=subject=>call(subject,null,'/api/account/state');
 const action=async(subject,input)=>{const r=await call(subject,input);assert.equal(r.status,200,JSON.stringify(r.body));return r.body;};
 const verification=subject=>{
  const sent=mail.findLast(m=>m.to[0]===subject+'@example.test');assert.ok(sent,'verification must come from actual captured transport payload');
  const link=new URL(sent.text.match(/https:\/\/\S+/)[0]);assert.equal(link.origin,origin);assert.equal(link.pathname,'/account/verify');assert.equal(link.search,'');
  const params=new URLSearchParams(link.hash.slice(1));return {action:'email-verify',challengeId:params.get('challenge'),token:params.get('token')};
 };
 return {db,mail,call,state,action,verification,tick:()=>now++};
}

test('closed pilot covers delivered-link verification and complete isolated hiring HTTP flow',async()=>{
 const f=fixture();try{
  const candidate=await f.action('candidate',signup('candidate','candidate'));
  const employer=await f.action('employer',signup('employer','employer'));
  assert.equal(candidate.emailStatus,'sent');assert.equal(employer.emailStatus,'sent');assert.equal(f.mail.length,2);
  assert.equal((await f.call('candidate',{action:'test-start',specialization:'Backend',grade:'Junior'})).status,403);
  assert.equal((await f.call('employer',{action:'search'})).status,403);
  const candidateLink=f.verification('candidate');
  assert.equal((await f.call('employer',candidateLink)).status,400);
  assert.equal((await f.action('candidate',candidateLink)).emailStatus,'verified');
  assert.equal((await f.call('candidate',candidateLink)).status,400,'single-use link');
  await f.action('employer',f.verification('employer'));
  assert.equal((await f.call('candidate',{action:'search',role:'employer',actor:employer.accountId})).status,403);
  await f.action('candidate',{action:'profile',about:'Synthetic backend engineer',experience:2,softSkills:'Teamwork',consent:true,published:true,contact:'forged@example.test',grade:'Senior',score:100});
  assert.equal((await f.action('employer',{action:'search'})).candidates.length,0,'profile edit cannot grant category');
  const started=await f.action('candidate',{action:'test-start',specialization:'Backend',grade:'Junior'});
  assert.equal(started.test.questions.length,12);
  for(const q of started.test.questions){assert.equal(q.answer,undefined);assert.equal(q.alternatives,undefined);}
  const resumed=(await f.state('candidate')).body;assert.equal(resumed.test.id,started.test.id,'fresh state resumes active assessment');
  // Answers are obtained only from the private test fixture database, never HTTP.
  const stored=await f.db.prepare('SELECT questions_json FROM real_assessments WHERE id=?').bind(started.test.id).first();
  const answers=Object.fromEntries(JSON.parse(stored.questions_json).map(q=>[q.id,q.answer]));
  f.tick();const scored=await f.action('candidate',{action:'test-submit',testId:started.test.id,answers});assert.equal(scored.passed,true);
  const candidateState=(await f.state('candidate')).body;assert.equal(candidateState.user.categoryConfirmed,true);assert.equal(candidateState.user.attempts.length,1);
  assert.equal(candidateState.accounts.length,1);assert.equal(candidateState.user.email,'candidate@example.test');
  await f.action('employer',{action:'company',company:'Synthetic employer',description:'Backend team',contact:'forged@example.test'});
  const found=await f.action('employer',{action:'search',specialization:'Backend',grade:'Junior',need:'Python SQL'});
  assert.equal(found.candidates.length,1);assert.equal(found.candidates[0].contact,undefined);assert.equal(found.candidates[0].email,undefined);
  const invite={action:'invite',candidateId:candidate.accountId,salaryFrom:100000,salaryTo:150000,salaryBasis:'net',description:'Synthetic invitation for backend engineer'};
  const invitation=(await f.action('employer',invite)).invitation;
  assert.equal(invitation.employerContact,'employer@example.test');assert.equal(invitation.salaryBasis,'net');
  await f.action('candidate',{action:'invitation-status',id:invitation.id,status:'viewed'});
  assert.equal((await f.state('employer')).body.invitations[0].candidateContact,undefined);
  await f.action('candidate',{action:'profile',consent:false,published:false});
  assert.equal((await f.call('candidate',{action:'invitation-status',id:invitation.id,status:'accepted'})).status,400,'acceptance requires contact consent');
  await f.action('candidate',{action:'profile',consent:true,published:true});
  await f.action('candidate',{action:'invitation-status',id:invitation.id,status:'accepted'});
  assert.equal((await f.state('employer')).body.invitations[0].candidateContact,'candidate@example.test');
  assert.equal((await f.action('employer',{action:'search'})).candidates[0].contact,'candidate@example.test');
  assert.equal((await f.call('candidate',{action:'invitation-status',id:invitation.id,status:'declined'})).status,409);
  await f.action('outsider-employer',signup('outsider-employer','employer'));await f.action('outsider-employer',f.verification('outsider-employer'));
  const outsider=await f.action('outsider-employer',{action:'search'});assert.equal(outsider.candidates.length,1);assert.equal(outsider.candidates[0].contact,undefined);
  assert.equal((await f.state('outsider-employer')).body.invitations.length,0);
  await f.action('candidate',{action:'profile',consent:false,published:false});
  assert.equal((await f.state('employer')).body.invitations[0].candidateContact,undefined,'withdrawal immediately closes contact');
  assert.equal((await f.action('employer',{action:'search'})).candidates.length,0);
  assert.equal(f.mail.length,3,'reads, verification, hiring and profile edits do not dispatch mail');
  const publicData=JSON.stringify((await f.state('candidate')).body);assert.ok(!publicData.includes(candidateLink.token));assert.ok(!publicData.includes(base.tokenSecret));
 }finally{f.db.close();}
});

for(const subjects of ['', 'not-json', '[]', '{}', '[""]', '[" candidate"]', '[42]', JSON.stringify(Array(101).fill('candidate'))]){
 test(`malformed pilot configuration fails closed (${subjects.slice(0,35)})`,async()=>{const f=fixture({...base,pilotSubjects:subjects});try{
  assert.equal((await f.state('candidate')).status,503);assert.equal((await f.call('candidate',signup('candidate','candidate'))).status,503);
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM real_accounts').first()).n,0);assert.equal(f.mail.length,0);
 }finally{f.db.close();}});
}
test('pilot denial precedes writes and cannot be bypassed by JSON, header, cookie or another issuer',async()=>{
 const f=fixture();try{
  const headers={'oai-authenticated-user-id':'candidate',cookie:'fsp_actor=candidate'};
  assert.equal((await f.call('blocked',{...signup('blocked','candidate'),subject:'candidate',principal:principal('candidate')},undefined,headers)).status,403);
  assert.equal((await f.state('blocked')).status,403);assert.equal((await f.state(null)).status,401);
  const response=await handleAccountRequest(new Request(origin+'/api/account/state'),{principal:{issuer:'other-issuer',subject:'candidate'},db:f.db,config:base});assert.equal(response.status,403);
  assert.equal(f.mail.length,0);assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM real_accounts').first()).n,0);
 }finally{f.db.close();}
});
test('runtime parser preserves configured pilot and defaults keep real mode disabled',()=>{
 assert.equal(realAccountsConfiguration({}).accountsEnabled,false);assert.equal(realAccountsConfiguration({}).pilotSubjects,undefined);
 assert.equal(realAccountsConfiguration({FSP_REAL_ACCOUNT_PILOT_SUBJECTS:'[]'}).pilotSubjects,'[]');
});

test('pilot protects PDF and can revoke an enrolled account without deleting its data',async()=>{
 const config={...base},f=fixture(config);try{
  await f.action('candidate',signup('candidate','candidate'));await f.action('candidate',f.verification('candidate'));
  const before=(await f.state('candidate')).body;assert.equal(before.user.verified,true);assert.equal(before.pilotSubjects,undefined);
  config.pilotSubjects=JSON.stringify(['employer']);
  assert.equal((await f.state('candidate')).status,403);
  assert.equal((await f.call('candidate',null,'/api/account/profile.pdf')).status,403);
  assert.equal((await f.call('candidate',{action:'profile',consent:true,published:true})).status,403);
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM real_accounts').first()).n,1);assert.equal(f.mail.length,1);
 }finally{f.db.close();}
});

test('every denied pilot route/action stops before all database, PDF and transport access',async()=>{
 const actions=['register','email-request','email-retry','email-verify','profile','company','test-start','test-submit','search','invite','invitation-status'];
 const requests=[...['state','profile.pdf'].map(path=>()=>new Request(origin+'/api/account/'+path)),...actions.map(action=>()=>new Request(origin+'/api/account/action',{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify({action})}))];
 for(const scenario of [
  {identity:principal('blocked'),config:base,status:403},
  {identity:{issuer:'other-issuer',subject:'candidate'},config:base,status:403},
  {identity:principal('candidate'),config:{...base,pilotSubjects:'not-json'},status:503},
  {identity:principal('candidate'),config:{...base,pilotSubjects:'[]'},status:503},
 ]){
  let databaseCalls=0,transportCalls=0,pdfCalls=0;
  const db={prepare(){databaseCalls++;throw new Error('Denied identity reached database');},batch(){databaseCalls++;throw new Error('Denied identity reached database');}};
  for(const makeRequest of requests){
   const response=await handleAccountRequest(makeRequest(),{principal:scenario.identity,db,config:scenario.config,emailFetcher:async()=>{transportCalls++;throw new Error('Denied identity reached transport');},renderProfile:async()=>{pdfCalls++;return new Uint8Array();}});
   assert.equal(response.status,scenario.status);
  }
  assert.equal(databaseCalls,0);assert.equal(transportCalls,0);assert.equal(pdfCalls,0);
 }
});

test('all role actions reject both unverified real roles without modifying rows or sending',async()=>{
 const f=fixture();try{
  await f.action('candidate',signup('candidate','candidate'));await f.action('employer',signup('employer','employer'));
  const tables=f.db.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row=>row.name);
  const snapshot=()=>JSON.stringify(tables.map(table=>f.db.sqlite.prepare(`SELECT * FROM "${table}"`).all()));const before=snapshot();
  for(const subject of ['candidate','employer'])for(const action of ['profile','company','test-start','test-submit','search','invite','invitation-status']){
   const response=await f.call(subject,{action});assert.equal(response.status,403);assert.equal(response.body.error,'Сначала подтвердите email.');
  }
  assert.equal(snapshot(),before);assert.equal(f.mail.length,2);
 }finally{f.db.close();}
});

test('revoked enrolled identity cannot request, retry or consume an email challenge',async()=>{
 const config={...base},f=fixture(config);try{
  await f.action('candidate',signup('candidate','candidate'));const verification=f.verification('candidate');
  config.pilotSubjects=JSON.stringify(['employer']);let reads=0;const prepare=f.db.prepare.bind(f.db);
  f.db.prepare=sql=>{reads++;return prepare(sql);};
  for(const input of [{action:'email-request'},{action:'email-retry'},verification])assert.equal((await f.call('candidate',input)).status,403);
  assert.equal(reads,0);assert.equal(f.mail.length,1);
 }finally{f.db.close();}
});
