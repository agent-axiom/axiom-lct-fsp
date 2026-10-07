import {test} from 'node:test';import assert from 'node:assert/strict';
import {sqliteD1} from './helpers/sqlite-d1.mjs';import {RealAccountsService} from '../lib/real-accounts.mjs';import {drainEmailOutbox,challengeToken} from '../lib/email-outbox.mjs';
const config={accountsEnabled:true,emailMode:'live',tokenSecret:'Synthetic-test-only-HMAC-material-0123456789',privacyNoticeUrl:'https://example.test/privacy',privacyNoticeVersion:'test-v1',resendApiKey:'synthetic-test-not-a-credential',sender:'verify@example.test',siteOrigin:'https://example.test'};
async function fixture(){const db=sqliteD1(),now=Date.now(),service=new RealAccountsService(db,config);await service.execute({issuer:'test',subject:'alice'},{action:'register',role:'candidate',name:'Alice Synthetic',email:'alice@example.test',dataConsent:true,privacyNoticeVersion:'test-v1'},now);return {db,now,close:()=>db.close()};}
const ok=()=>({ok:true,status:200,json:async()=>({id:'synthetic-provider-message'})});
test('disabled dispatch never calls an external transport or claims jobs',async()=>{const f=await fixture();try{let calls=0;const r=await drainEmailOutbox(f.db,{...config,emailMode:'off'},{now:f.now,fetcher:async()=>{calls++;return ok();}});assert.equal(r.enabled,false);assert.equal(calls,0);assert.equal((await f.db.prepare('SELECT attempts FROM real_email_outbox').first()).attempts,0);}finally{f.close();}});
test('queued job is delivered once with stable idempotency key and no plaintext token at rest',async()=>{const f=await fixture();try{const sent=[];const fetcher=async(url,input)=>{sent.push({url,input});return ok();};const r=await drainEmailOutbox(f.db,config,{now:f.now+1,fetcher});assert.equal(r.sent,1);await drainEmailOutbox(f.db,config,{now:f.now+2,fetcher});assert.equal(sent.length,1);assert.equal(sent[0].url,'https://api.resend.com/emails');const challenge=await f.db.prepare('SELECT * FROM real_email_challenges').first();const token=await challengeToken(config.tokenSecret,challenge);assert.ok(sent[0].input.body.includes('#challenge='));assert.ok(sent[0].input.body.includes(token));assert.equal(sent[0].input.headers['Idempotency-Key'],`fsp-verify-${challenge.id}`);assert.ok(!JSON.stringify(await f.db.prepare('SELECT * FROM real_email_outbox').first()).includes(token));assert.equal(challenge.delivery_state,'sent');}finally{f.close();}});
test('transient failure retries the identical payload and idempotency key after backoff',async()=>{const f=await fixture();try{const requests=[];let attempts=0;const fetcher=async(url,input)=>{requests.push(input);return ++attempts===1?{ok:false,status:503}:ok();};await drainEmailOutbox(f.db,config,{now:f.now+1,fetcher});assert.equal((await f.db.prepare('SELECT status FROM real_email_outbox').first()).status,'retry');await drainEmailOutbox(f.db,config,{now:f.now+2,fetcher});assert.equal(attempts,1);await drainEmailOutbox(f.db,config,{now:f.now+61000,fetcher});assert.equal(attempts,2);assert.equal(requests[0].body,requests[1].body);assert.equal(requests[0].headers['Idempotency-Key'],requests[1].headers['Idempotency-Key']);}finally{f.close();}});
test('permanent provider errors fail without exposing recipient or provider body',async()=>{const f=await fixture();try{await drainEmailOutbox(f.db,config,{now:f.now+1,fetcher:async()=>({ok:false,status:403,json:async()=>({message:'secret body'})})});const row=await f.db.prepare('SELECT * FROM real_email_outbox').first();assert.equal(row.status,'failed');assert.equal(row.last_error_code,'HTTP_403');assert.equal((await f.db.prepare('SELECT email_verified_at FROM real_accounts').first()).email_verified_at,null);}finally{f.close();}});
test('worker crash after provider acceptance is recovered by lease and provider idempotency',async()=>{const f=await fixture();try{const keys=[];const fetcher=async(url,input)=>{keys.push(input.headers['Idempotency-Key']);return ok();};f.db.failOnceWhen=/UPDATE real_email_outbox SET status='sent'/;await assert.rejects(drainEmailOutbox(f.db,config,{now:f.now+1,fetcher}),/Injected/);assert.equal((await f.db.prepare('SELECT status FROM real_email_outbox').first()).status,'leased');await drainEmailOutbox(f.db,config,{now:f.now+30000,fetcher});assert.equal(keys.length,1);await drainEmailOutbox(f.db,config,{now:f.now+61002,fetcher});assert.equal(keys.length,2);assert.equal(keys[0],keys[1]);assert.equal((await f.db.prepare('SELECT status FROM real_email_outbox').first()).status,'sent');}finally{f.close();}});
test('expired challenge cancels job without transmission',async()=>{const f=await fixture();try{let calls=0;await drainEmailOutbox(f.db,config,{now:f.now+16*60000,fetcher:async()=>{calls++;return ok();}});assert.equal(calls,0);assert.equal((await f.db.prepare('SELECT status FROM real_email_outbox').first()).status,'cancelled');}finally{f.close();}});
test('changed token secret fails closed rather than sending an unverifiable link',async()=>{const f=await fixture();try{let calls=0;await drainEmailOutbox(f.db,{...config,tokenSecret:'Different-synthetic-test-material-0123456789'},{now:f.now+1,fetcher:async()=>{calls++;return ok();}});assert.equal(calls,0);assert.equal((await f.db.prepare('SELECT last_error_code FROM real_email_outbox').first()).last_error_code,'TOKEN_KEY_CHANGED');}finally{f.close();}});
test('two overlapping workers cannot claim the same unexpired lease',async()=>{const f=await fixture();try{let calls=0;let release;const pending=new Promise(resolve=>{release=resolve;});const first=drainEmailOutbox(f.db,config,{now:f.now+1,fetcher:async()=>{calls++;await pending;return ok();}});await new Promise(resolve=>setTimeout(resolve,10));const second=await drainEmailOutbox(f.db,config,{now:f.now+2,fetcher:async()=>{calls++;return ok();}});assert.equal(second.processed,0);release();await first;assert.equal(calls,1);}finally{f.close();}});

test('incomplete live dispatch configuration fails before claiming jobs or calling transport',async()=>{
  for(const override of [{resendApiKey:''},{sender:''},{tokenSecret:''},{tokenSecret:'short'},{siteOrigin:''},{siteOrigin:'invalid'},{siteOrigin:'https://example.test/path'}]){
    const f=await fixture();
    try{
      let calls=0;
      await assert.rejects(drainEmailOutbox(f.db,{...config,...override},{now:f.now+1,fetcher:async()=>{calls++;return ok();}}),error=>error.status===503);
      const job=await f.db.prepare('SELECT status,attempts,lease_id FROM real_email_outbox').first();
      assert.equal(job.status,'queued');assert.equal(job.attempts,0);assert.equal(job.lease_id,null);assert.equal(calls,0);
    }finally{f.close();}
  }
});
const malformedSuccesses=[
  ['missing ID',async()=>({})],
  ['null ID',async()=>({id:null})],
  ['non-string ID',async()=>({id:123})],
  ['empty ID',async()=>({id:''})],
  ['blank ID',async()=>({id:'   '})],
  ['null body',async()=>null],
  ['invalid JSON',async()=>{throw new SyntaxError('Synthetic malformed provider body');}],
];
for(const [label,json] of malformedSuccesses){
  test(`malformed success is retried with unchanged payload and key: ${label}`,async()=>{
    const f=await fixture(),requests=[];
    try{
      const fetcher=async(url,input)=>{requests.push(input);return requests.length===1?{ok:true,status:200,json}:ok();};
      assert.equal((await drainEmailOutbox(f.db,config,{now:f.now+1,fetcher})).sent,0);
      const job=await f.db.prepare('SELECT * FROM real_email_outbox').first();
      assert.equal(job.status,'retry');assert.equal(job.last_error_code,'INVALID_PROVIDER_RESPONSE');assert.equal(job.lease_until,null);assert.equal(job.provider_message_id,null);assert.equal(job.sent_at,null);
      assert.equal((await f.db.prepare('SELECT delivery_state FROM real_email_challenges').first()).delivery_state,'pending');
      assert.equal((await f.db.prepare('SELECT email_verified_at FROM real_accounts').first()).email_verified_at,null);
      await drainEmailOutbox(f.db,config,{now:f.now+2,fetcher});assert.equal(requests.length,1);
      assert.equal((await drainEmailOutbox(f.db,config,{now:job.next_attempt_at,fetcher})).sent,1);
      assert.equal(requests.length,2);assert.equal(requests[0].body,requests[1].body);assert.equal(requests[0].headers['Idempotency-Key'],requests[1].headers['Idempotency-Key']);
      assert.equal((await f.db.prepare('SELECT provider_message_id FROM real_email_outbox').first()).provider_message_id,'synthetic-provider-message');
    }finally{f.close();}
  });
}
test('repeated malformed successes exhaust retry budget without marking delivery or verification',async()=>{
  const f=await fixture(),requests=[];
  try{
    let now=f.now+1;
    for(let attempt=1;attempt<=5;attempt++){
      const result=await drainEmailOutbox(f.db,config,{now,fetcher:async(url,input)=>{requests.push(input);return {ok:true,status:200,json:async()=>({})};}});
      assert.equal(result.sent,0);
      const job=await f.db.prepare('SELECT * FROM real_email_outbox').first();
      assert.equal(job.attempts,attempt);assert.equal(job.status,attempt===5?'failed':'retry');assert.equal(job.last_error_code,'INVALID_PROVIDER_RESPONSE');now=job.next_attempt_at;
    }
    let unexpectedCalls=0;
    const terminal=await drainEmailOutbox(f.db,config,{now,fetcher:async()=>{unexpectedCalls++;return ok();}});
    assert.equal(terminal.processed,0);assert.equal(unexpectedCalls,0);
    assert.equal(requests.length,5);assert.equal(new Set(requests.map(request=>request.body)).size,1);assert.equal(new Set(requests.map(request=>request.headers['Idempotency-Key'])).size,1);
    assert.equal((await f.db.prepare('SELECT delivery_state FROM real_email_challenges').first()).delivery_state,'pending');
    assert.equal((await f.db.prepare('SELECT email_verified_at FROM real_accounts').first()).email_verified_at,null);
  }finally{f.close();}
});
test('OFF dispatch ignores incomplete live settings and old blocked jobs are not activated by live mode',async()=>{
  const f=await fixture();
  try{
    await f.db.prepare("UPDATE real_email_outbox SET status='blocked'").run();
    let calls=0;const fetcher=async()=>{calls++;return ok();};
    assert.equal((await drainEmailOutbox(f.db,{emailMode:'off'},{fetcher})).enabled,false);
    assert.equal((await drainEmailOutbox(f.db,config,{now:f.now+1,fetcher})).processed,0);
    assert.equal(calls,0);assert.equal((await f.db.prepare('SELECT status FROM real_email_outbox').first()).status,'blocked');
  }finally{f.close();}
});
