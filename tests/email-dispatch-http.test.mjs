import {test} from 'node:test';
import assert from 'node:assert/strict';
import {handleAccountRequest} from '../lib/real-account-http.mjs';
import {RealAccountsService} from '../lib/real-accounts.mjs';
import {challengeToken,dispatchAccountEmail} from '../lib/email-outbox.mjs';
import {sqliteD1} from './helpers/sqlite-d1.mjs';

const settings={accountsEnabled:true,emailMode:'live',tokenSecret:'Synthetic-test-only-HMAC-material-0123456789',privacyNoticeUrl:'https://example.test/privacy',privacyNoticeVersion:'test-v1',resendApiKey:'synthetic-test-not-a-credential',sender:'verify@example.test',siteOrigin:'https://example.test'};
const alice={issuer:'test',subject:'alice'},bob={issuer:'test',subject:'bob'};
const registration={action:'register',role:'candidate',name:'Alice synthetic',email:'alice@example.test',dataConsent:true,privacyNoticeVersion:'test-v1'};
const accepted=()=>({ok:true,status:200,json:async()=>({id:'synthetic-provider-message'})});
const request=(body,origin='https://example.test')=>new Request('https://example.test/api/account/action',{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};}
function fixture(override={}){
  const db=sqliteD1(),config={...settings,...override};
  const f={db,config,now:Date.now(),calls:[],reply:async()=>accepted(),close:()=>db.close()};
  f.fetcher=async(url,input)=>{f.calls.push({url,...input});return f.reply(url,input);};
  f.call=async(body,options={})=>{
    const response=await handleAccountRequest(request(body,options.origin),{principal:alice,db,config,clock:()=>f.now,emailFetcher:f.fetcher,...options});
    return {status:response.status,body:await response.json(),headers:response.headers};
  };
  f.state=async(principal=alice)=>(await handleAccountRequest(new Request('https://example.test/api/account/state'),{principal,db,config,clock:()=>f.now,emailFetcher:f.fetcher})).json();
  f.job=async(challengeId)=>(challengeId?db.prepare('SELECT * FROM real_email_outbox WHERE challenge_id=?').bind(challengeId):db.prepare('SELECT * FROM real_email_outbox ORDER BY created_at DESC LIMIT 1')).first();
  f.challenge=async(id)=>(id?db.prepare('SELECT * FROM real_email_challenges WHERE id=?').bind(id):db.prepare('SELECT * FROM real_email_challenges ORDER BY created_at DESC LIMIT 1')).first();
  f.count=async table=>(await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first()).n;
  return f;
}

test('HTTP registration awaits exactly one own delivery, returns safe status, and GET never sends',async()=>{
  const f=fixture();try{
    const result=await f.call(registration);assert.equal(result.status,200);assert.equal(result.body.emailStatus,'sent');assert.equal(result.body.emailAttempts,1);assert.equal(result.body.emailRetryAllowed,false);assert.equal(f.calls.length,1);
    assert.equal(f.calls[0].url,'https://api.resend.com/emails');assert.deepEqual(JSON.parse(f.calls[0].body).to,['alice@example.test']);
    const state=await f.state();assert.equal(state.emailStatus,'sent');assert.equal(state.user.verified,false);assert.equal(f.calls.length,1);
    for(const secret of ['token_hash','payload_hash','lease_id','provider_message_id',settings.tokenSecret,settings.resendApiKey])assert.equal(JSON.stringify([result.body,state]).includes(secret),false);
    assert.equal(result.headers.get('Cache-Control'),'no-store');assert.equal(await f.count('real_email_challenges'),1);
  }finally{f.close();}
});
test('HTTP OFF never calls transport or takes leases; blocked rows stay blocked after enabling',async()=>{
  const f=fixture({emailMode:'off'});try{
    assert.equal((await f.call(registration)).body.emailStatus,'blocked');
    assert.equal((await f.call({action:'email-retry'})).body.emailStatus,'blocked');
    f.now+=60000;assert.equal((await f.call({action:'email-request'})).body.emailStatus,'blocked');
    f.config.emailMode='live';assert.equal((await f.call({action:'email-retry'})).body.emailStatus,'blocked');
    assert.equal(f.calls.length,0);assert.equal((await f.job()).attempts,0);
    f.now+=60000;assert.equal((await f.call({action:'email-request'})).body.emailStatus,'sent');assert.equal(f.calls.length,1);
  }finally{f.close();}
});
test('HTTP principal, origin, and foreign-target checks cannot dispatch another account',async()=>{
  const f=fixture();try{
    assert.equal((await f.call({...registration,principal:alice,accountId:'forged'}, {principal:null})).status,401);
    assert.equal((await f.call(registration,{origin:'https://untrusted.example.test'})).status,403);
    assert.equal(await f.count('real_accounts'),0);assert.equal(f.calls.length,0);
    const own=await new RealAccountsService(f.db,f.config).execute(alice,registration,f.now);
    assert.equal((await f.call({action:'email-retry'},{principal:bob})).status,403);
    for(const action of ['email-request','email-retry'])for(const hint of [{challengeId:own.challengeId},{accountId:own.accountId},{recipient:'other@example.test'},{email:'other@example.test'},{actor:own.accountId}]){
      assert.equal((await f.call({action,...hint})).status,400);
    }
    await new RealAccountsService(f.db,f.config).execute(bob,{...registration,name:'Bob synthetic',email:'bob@example.test'},f.now);
    await assert.rejects(dispatchAccountEmail(f.db,f.config,{principal:bob,challengeId:own.challengeId,clock:()=>f.now,fetcher:f.fetcher}),error=>error.status===403);
    assert.equal(f.calls.length,0);assert.equal((await f.job(own.challengeId)).attempts,0);
  }finally{f.close();}
});
test('registration replay after a lost successful HTTP response creates no second challenge or email and cannot change role/email',async()=>{
  const f=fixture();try{
    const initial=await f.call(registration); // caller loses this response
    const replay=await f.call({...registration,role:'employer',email:'replacement@example.test',name:'Replacement'});
    assert.equal(replay.status,200);assert.equal(replay.body.accountId,initial.body.accountId);assert.equal(replay.body.challengeId,initial.body.challengeId);assert.equal(replay.body.role,'candidate');
    assert.equal(f.calls.length,1);assert.equal(await f.count('real_email_challenges'),1);assert.equal((await f.state()).user.email,'alice@example.test');
  }finally{f.close();}
});
test('registration replay after commit but before first dispatch resumes the exact stored challenge',async()=>{
  const f=fixture();try{
    const initial=await new RealAccountsService(f.db,f.config).execute(alice,registration,f.now);
    const replay=await f.call(registration);assert.equal(replay.body.challengeId,initial.challengeId);assert.equal(replay.body.emailStatus,'sent');assert.equal(f.calls.length,1);assert.equal(await f.count('real_email_challenges'),1);
  }finally{f.close();}
});
test('HTTP crash after provider acceptance leaves a lease; explicit retry later reuses payload and key',async()=>{
  const f=fixture();try{
    f.db.failOnceWhen=/UPDATE real_email_outbox SET status='sent'/;
    assert.equal((await f.call(registration)).status,503);const job=await f.job();assert.equal(job.status,'leased');
    const during=await f.call({action:'email-retry'});assert.equal(during.body.emailStatus,'leased');assert.equal(during.body.emailRetryAt,job.lease_until);assert.equal(f.calls.length,1);
    f.now=job.lease_until;assert.equal((await f.call({action:'email-retry'})).body.emailStatus,'sent');
    assert.equal(f.calls.length,2);assert.equal(f.calls[0].body,f.calls[1].body);assert.equal(f.calls[0].headers['Idempotency-Key'],f.calls[1].headers['Idempotency-Key']);assert.equal(await f.count('real_email_challenges'),1);
  }finally{f.close();}
});
test('overlapping authenticated calls cannot share an active lease',async()=>{
  const f=fixture(),entered=deferred(),release=deferred();try{
    f.reply=async()=>{entered.resolve();await release.promise;return accepted();};
    const pending=f.call(registration);await entered.promise;
    const second=await f.call({action:'email-retry'}),replay=await f.call(registration);
    assert.equal(second.body.emailStatus,'leased');assert.equal(replay.body.emailStatus,'leased');assert.equal(f.calls.length,1);
    release.resolve();assert.equal((await pending).body.emailStatus,'sent');assert.equal((await f.job()).attempts,1);
  }finally{release.resolve();f.close();}
});
test('network ambiguity requires explicit retry with identical payload/key, backoff and max five attempts',async()=>{
  const f=fixture();try{
    f.reply=async()=>{throw new Error('synthetic network ambiguity');};
    let result=await f.call(registration);assert.equal(result.body.emailStatus,'retry');
    for(let attempt=1;attempt<=5;attempt++){
      const job=await f.job();assert.equal(job.attempts,attempt);assert.equal(f.calls.length,attempt);assert.equal(job.status,attempt===5?'failed':'retry');
      assert.equal(job.next_attempt_at-f.now,Math.min(300000,60000*2**(attempt-1)));
      if(attempt<5){
        assert.equal((await f.call({action:'email-retry'})).body.emailStatus,'retry');assert.equal(f.calls.length,attempt);
        await f.state();assert.equal(f.calls.length,attempt);f.now=job.next_attempt_at;result=await f.call({action:'email-retry'});assert.equal(result.status,200);
      }
    }
    f.now+=1000;assert.equal((await f.call({action:'email-retry'})).body.emailStatus,'failed');assert.equal(f.calls.length,5);assert.equal(new Set(f.calls.map(c=>c.body)).size,1);assert.equal(new Set(f.calls.map(c=>c.headers['Idempotency-Key'])).size,1);assert.equal(await f.count('real_email_challenges'),1);
  }finally{f.close();}
});
test('five lost acknowledgements exhaust the budget even for expired leases',async()=>{
  const f=fixture();try{
    for(let attempt=1;attempt<=5;attempt++){
      f.db.failOnceWhen=/UPDATE real_email_outbox SET status='sent'/;
      assert.equal((await f.call(attempt===1?registration:{action:'email-retry'})).status,503);
      const job=await f.job();assert.equal(job.attempts,attempt);f.now=job.lease_until;
    }
    const result=await f.call({action:'email-retry'});assert.equal(result.body.emailStatus,'failed');assert.equal(result.body.emailRetryAllowed,false);assert.equal((await f.job()).attempts,5);assert.equal(f.calls.length,5);
  }finally{f.close();}
});
for(const [label,reply,status] of [
  ['permanent rejection',async()=>({ok:false,status:403}),'failed'],
  ['transient rejection',async()=>({ok:false,status:503}),'retry'],
  ['malformed success body',async()=>({ok:true,status:200,json:async()=>{throw new SyntaxError('synthetic');}}),'retry'],
  ['malformed success ID',async()=>({ok:true,status:200,json:async()=>({id:' '})}),'retry'],
])test(`HTTP ${label} is truthful and never verifies an account`,async()=>{
  const f=fixture();try{
    f.reply=reply;const result=await f.call(registration);assert.equal(result.status,200);assert.equal(result.body.emailStatus,status);assert.equal((await f.state()).user.verified,false);assert.equal((await f.challenge()).delivery_state,'pending');assert.equal(f.calls.length,1);
    if(status==='retry'){f.now=(await f.job()).next_attempt_at;f.reply=async()=>accepted();assert.equal((await f.call({action:'email-retry'})).body.emailStatus,'sent');assert.equal(f.calls[0].body,f.calls[1].body);}
  }finally{f.close();}
});
test('resend prioritizes the exact new challenge instead of draining another account or older jobs',async()=>{
  const f=fixture();try{
    const service=new RealAccountsService(f.db,f.config),old=await service.execute(alice,registration,f.now);
    const other=await service.execute(bob,{...registration,name:'Bob synthetic',email:'bob@example.test'},f.now);
    f.now+=60000;const fresh=await f.call({action:'email-request'});assert.notEqual(fresh.body.challengeId,old.challengeId);assert.equal(fresh.body.emailStatus,'sent');assert.equal(f.calls.length,1);
    assert.equal(f.calls[0].headers['Idempotency-Key'],`fsp-verify-${fresh.body.challengeId}`);assert.equal((await f.job(old.challengeId)).attempts,0);assert.equal((await f.job(other.challengeId)).attempts,0);
    assert.equal((await f.call({action:'email-retry'})).body.challengeId,fresh.body.challengeId);assert.equal(f.calls.length,1);
  }finally{f.close();}
});
test('fresh resend preserves the previously accepted token until new delivery acceptance, then supersedes it',async()=>{
  const f=fixture();try{
    const first=await f.call(registration),old=await f.challenge(first.body.challengeId);f.now+=60000;f.reply=async()=>({ok:false,status:503});
    const fresh=await f.call({action:'email-request'});assert.equal(fresh.body.emailStatus,'retry');assert.equal((await f.challenge(old.id)).consumed_at,null);assert.equal((await f.challenge(old.id)).delivery_state,'sent');
    f.now=(await f.job(fresh.body.challengeId)).next_attempt_at;f.reply=async()=>accepted();assert.equal((await f.call({action:'email-retry'})).body.emailStatus,'sent');assert.equal((await f.challenge(old.id)).delivery_state,'superseded');
    assert.equal((await f.call({action:'email-verify',challengeId:old.id,token:await challengeToken(f.config.tokenSecret,old)})).status,400);
    const current=await f.challenge(fresh.body.challengeId);assert.equal((await f.call({action:'email-verify',challengeId:current.id,token:await challengeToken(f.config.tokenSecret,current)})).body.emailStatus,'verified');
    const calls=f.calls.length;assert.equal((await f.call({action:'email-request'})).body.emailStatus,'verified');assert.equal((await f.call({action:'email-retry'})).body.emailStatus,'verified');assert.equal(f.calls.length,calls);
  }finally{f.close();}
});
test('previous accepted link really verifies while a newer delivery remains failed',async()=>{
  const f=fixture();try{
    const first=await f.call(registration),old=await f.challenge(first.body.challengeId);f.now+=60000;f.reply=async()=>({ok:false,status:503});await f.call({action:'email-request'});
    assert.equal((await f.call({action:'email-verify',challengeId:old.id,token:await challengeToken(f.config.tokenSecret,old)})).body.emailStatus,'verified');
    f.now+=60000;const calls=f.calls.length;assert.equal((await f.call({action:'email-retry'})).body.emailStatus,'verified');assert.equal(f.calls.length,calls);
  }finally{f.close();}
});
test('newer accepted delivery cannot be superseded by a late older provider response',async()=>{
  const f=fixture(),entered=deferred(),release=deferred();try{
    f.reply=async()=>{entered.resolve();await release.promise;return accepted();};const oldCall=f.call(registration);await entered.promise;const old=await f.challenge();
    f.now+=60000;f.reply=async()=>accepted();const fresh=await f.call({action:'email-request'});assert.equal(fresh.body.emailStatus,'sent');release.resolve();await oldCall;
    assert.equal((await f.challenge(old.id)).delivery_state,'superseded');assert.equal((await f.challenge(fresh.body.challengeId)).delivery_state,'sent');assert.equal((await f.job(old.id)).status,'cancelled');
  }finally{release.resolve();f.close();}
});
test('resend observes existing minute and hourly creation limits, retry creates no challenges',async()=>{
  const f=fixture();try{
    await f.call(registration);assert.equal((await f.call({action:'email-request'})).status,429);
    for(let i=1;i<5;i++){f.now+=60000;assert.equal((await f.call({action:'email-request'})).status,200);}
    f.now+=60000;assert.equal((await f.call({action:'email-request'})).status,429);await f.call({action:'email-retry'});assert.equal(f.calls.length,5);assert.equal(await f.count('real_email_challenges'),5);
  }finally{f.close();}
});
for(const [label,mutate] of [
  ['expired',async f=>{f.now+=15*60000;}],
  ['consumed',async f=>f.db.prepare('UPDATE real_email_challenges SET consumed_at=?').bind(f.now).run()],
  ['five bad tokens',async f=>f.db.prepare('UPDATE real_email_challenges SET failed_attempts=5').run()],
  ['changed email',async f=>f.db.prepare("UPDATE real_accounts SET email='changed@example.test'").run()],
])test(`HTTP retry skips an unavailable ${label} challenge before transport`,async()=>{
  const f=fixture();try{
    await new RealAccountsService(f.db,f.config).execute(alice,registration,f.now);await mutate(f);
    const result=await f.call({action:'email-retry'});assert.equal(result.body.emailStatus,'cancelled');assert.equal(result.body.emailRetryAllowed,false);assert.equal(f.calls.length,0);assert.equal((await f.job()).status,'cancelled');
  }finally{f.close();}
});
test('verification during an in-flight resend does not reactivate mail or change the verified account',async()=>{
  const f=fixture(),entered=deferred(),release=deferred();try{
    const first=await f.call(registration),old=await f.challenge(first.body.challengeId);f.now+=60000;
    f.reply=async()=>{entered.resolve();await release.promise;return accepted();};const pending=f.call({action:'email-request'});await entered.promise;
    assert.equal((await f.call({action:'email-verify',challengeId:old.id,token:await challengeToken(f.config.tokenSecret,old)})).body.emailStatus,'verified');release.resolve();assert.equal((await pending).body.emailStatus,'verified');assert.equal((await f.job()).status,'cancelled');assert.equal((await f.state()).user.verified,true);
  }finally{release.resolve();f.close();}
});
test('account email changing during provider call cancels completion without enabling that link',async()=>{
  const f=fixture(),entered=deferred(),release=deferred();try{
    f.reply=async()=>{entered.resolve();await release.promise;return accepted();};const pending=f.call(registration);await entered.promise;
    await f.db.prepare("UPDATE real_accounts SET email='changed@example.test'").run();release.resolve();assert.equal((await pending).body.emailStatus,'cancelled');assert.equal((await f.challenge()).delivery_state,'pending');assert.equal((await f.job()).status,'cancelled');
  }finally{release.resolve();f.close();}
});
for(const [label,override] of [['sender',{sender:'changed@example.test'}],['origin',{siteOrigin:'https://changed.example.test'}],['secret',{tokenSecret:'Different-synthetic-test-material-0123456789'}]])test(`retry fails closed on changed ${label}, with no second transport call`,async()=>{
  const f=fixture();try{
    f.reply=async()=>{throw new Error('synthetic ambiguity');};await f.call(registration);f.now=(await f.job()).next_attempt_at;Object.assign(f.config,override);
    assert.equal((await f.call({action:'email-retry'})).body.emailStatus,'failed');assert.equal(f.calls.length,1);assert.equal((await f.job()).last_error_code,label==='secret'?'TOKEN_KEY_CHANGED':'PAYLOAD_CHANGED');
  }finally{f.close();}
});
test('legacy attempted jobs without fingerprints fail closed; never-attempted legacy jobs initialize once',async()=>{
  const f=fixture();try{
    await new RealAccountsService(f.db,f.config).execute(alice,registration,f.now);await f.db.prepare('UPDATE real_email_outbox SET payload_hash=NULL,attempts=1').run();
    assert.equal((await f.call({action:'email-retry'})).body.emailStatus,'failed');assert.equal((await f.job()).last_error_code,'PAYLOAD_UNAVAILABLE');assert.equal(f.calls.length,0);
    f.now+=60000;const next=await new RealAccountsService(f.db,f.config).execute(alice,{action:'email-request'},f.now);await f.db.prepare('UPDATE real_email_outbox SET payload_hash=NULL WHERE challenge_id=?').bind(next.challengeId).run();
    assert.equal((await f.call({action:'email-retry'})).body.emailStatus,'sent');assert.equal(f.calls.length,1);assert.match((await f.job()).payload_hash,/^[a-f0-9]{64}$/);
  }finally{f.close();}
});
test('HTTP retry without an existing challenge does not silently create one',async()=>{
  const f=fixture({emailMode:'off',tokenSecret:''});try{
    assert.equal((await f.call(registration)).body.emailStatus,'not_configured');Object.assign(f.config,settings);
    assert.equal((await f.call({action:'email-retry'})).body.emailStatus,'not_requested');assert.equal(f.calls.length,0);assert.equal(await f.count('real_email_challenges'),0);
  }finally{f.close();}
});
test('HTTP timeout is bounded even if a mock transport ignores abort; no background retry starts',async()=>{
  const f=fixture();try{
    f.reply=()=>new Promise(()=>{});const started=Date.now();const result=await f.call(registration);
    assert.equal(result.body.emailStatus,'retry');assert.equal(f.calls[0].signal.aborted,true);assert.ok(Date.now()-started>=9900);assert.ok(Date.now()-started<15000);assert.equal(f.calls.length,1);assert.equal((await f.job()).attempts,1);
  }finally{f.close();}
});


test('superseding between token read and verification commit never returns a false verified result',async()=>{
  const f=fixture();try{
    const first=await f.call(registration),old=await f.challenge(first.body.challengeId),token=await challengeToken(f.config.tokenSecret,old);
    const batch=f.db.batch.bind(f.db);let superseded=false;
    f.db.batch=async statements=>{
      if(!superseded&&statements.some(s=>s.sql.startsWith('UPDATE real_email_challenges SET consumed_at=? WHERE id=?'))){
        superseded=true;
        // Match the verification timestamp to catch a consumed_at-only guard.
        await f.db.prepare("UPDATE real_email_challenges SET consumed_at=?,delivery_state='superseded' WHERE id=?").bind(f.now,old.id).run();
      }
      return batch(statements);
    };
    const result=await f.call({action:'email-verify',challengeId:old.id,token});assert.equal(superseded,true);assert.equal(result.status,400);assert.equal((await f.state()).user.verified,false);
  }finally{f.close();}
});
test('expiry during provider response does not activate a now-expired challenge',async()=>{
  const f=fixture();try{
    f.reply=async()=>{f.now+=15*60000;return accepted();};const result=await f.call(registration);
    assert.equal(result.body.emailStatus,'cancelled');assert.equal((await f.job()).status,'cancelled');assert.equal((await f.challenge()).delivery_state,'pending');assert.equal((await f.state()).user.verified,false);assert.equal(f.calls.length,1);
  }finally{f.close();}
});
test('account deletion during provider response neither recreates it nor exposes a stale success',async()=>{
  const f=fixture();try{
    f.reply=async()=>{await f.db.prepare("DELETE FROM real_accounts WHERE subject='alice'").run();return accepted();};
    assert.equal((await f.call(registration)).status,403);assert.equal(await f.count('real_accounts'),0);assert.equal(await f.count('real_email_outbox'),0);assert.equal(f.calls.length,1);
  }finally{f.close();}
});

test('additive payload-fingerprint migration preserves existing accounts, profiles, evidence, history and jobs',async()=>{
  const f=fixture();try{
    const candidate=await f.call(registration);
    await f.call({...registration,role:'employer',name:'Bob synthetic',email:'bob@example.test'},{principal:bob});
    await f.db.prepare('UPDATE real_accounts SET email_verified_at=?').bind(f.now).run();
    const service=new RealAccountsService(f.db,f.config);
    await service.execute(alice,{action:'profile',about:'Synthetic retained profile',experience:3,consent:true,published:true},f.now);
    const started=await service.execute(alice,{action:'test-start',specialization:'Backend',grade:'Junior'},f.now);
    const stored=await f.db.prepare('SELECT questions_json FROM real_assessments WHERE id=?').bind(started.test.id).first();
    await service.execute(alice,{action:'test-submit',testId:started.test.id,answers:Object.fromEntries(JSON.parse(stored.questions_json).map(q=>[q.id,q.answer]))},f.now+1);
    await service.execute(bob,{action:'search',need:'Junior Backend Python SQL'},f.now+2);
    await service.execute(bob,{action:'invite',candidateId:candidate.body.accountId,salaryFrom:100000,salaryTo:150000,salaryBasis:'net',description:'Synthetic retained invitation'},f.now+3);
    for(const table of ['real_accounts','real_candidate_profiles','real_employer_profiles','real_assessments','real_skill_evidence','real_searches','real_invitations','real_email_challenges','real_email_outbox'])assert.ok(await f.count(table)>0);
    // Reconstruct the immediately preceding schema, then upgrade populated data.
    f.db.sqlite.exec('ALTER TABLE real_email_outbox DROP COLUMN payload_hash');
    const tables=f.db.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row=>row.name);
    const before=Object.fromEntries(tables.map(table=>[table,f.db.sqlite.prepare(`SELECT * FROM ${table}`).all()]));
    const {readFileSync}=await import('node:fs');
    f.db.sqlite.exec(readFileSync(new URL('../drizzle/0004_email_payload_fingerprint.sql',import.meta.url),'utf8'));
    for(const table of tables){
      const after=f.db.sqlite.prepare(`SELECT * FROM ${table}`).all();
      if(table==='real_email_outbox')for(const row of after){assert.equal(row.payload_hash,null);delete row.payload_hash;}
      assert.deepEqual(after,before[table]);
    }
  }finally{f.close();}
});
