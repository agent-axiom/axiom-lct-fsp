import {test} from 'node:test';
import assert from 'node:assert/strict';
import {publicEmailAuthConfiguration} from '../lib/public-email-auth.mjs';
import {tokenHash} from '../lib/email-outbox.mjs';
import {handlePublicAccountRequest} from '../lib/public-account-http.mjs';
import {handleAccountRequest} from '../lib/real-account-http.mjs';
import {sqliteD1} from './helpers/sqlite-d1.mjs';

// All users and mail are synthetic. Every provider call is intercepted locally.
const origin='https://email-auth.example.test';
const base={accountsEnabled:true,emailAuthEnabled:true,emailMode:'live',emailTransport:'resend',
 tokenSecret:'Synthetic-test-only-HMAC-material-0123456789',resendApiKey:'synthetic-not-a-credential',
 sender:'noreply@notify.example.test',siteOrigin:origin,
 privacyNoticeUrl:origin+'/privacy',privacyNoticeVersion:'synthetic-v1'};
const register=(email='candidate@example.test',role='candidate')=>({mode:'register',email,role,
 name:`Synthetic ${role}`,dataConsent:true,privacyNoticeVersion:base.privacyNoticeVersion});
const login=email=>({mode:'login',email});
const success=response=>assert.equal(response.status,200,JSON.stringify(response.body));
const denied=response=>assert.ok(response.status>=400,`Unexpected ${response.status}: ${JSON.stringify(response.body)}`);

function fixture(config={...base},{delivery}={}){
 const db=sqliteD1(),mail=[];let now=Date.UTC(2026,9,11,10);
 const emailFetcher=async(url,options)=>{
  assert.equal(url,'https://api.resend.com/emails');assert.equal(options.method,'POST');
  const payload=JSON.parse(options.body);mail.push(payload);
  return delivery?delivery(payload):Response.json({id:`synthetic-mail-${mail.length}`});
 };
 const browser=()=>({cookies:new Map()});
 const cookieHeader=client=>[...client.cookies].map(([name,value])=>`${name}=${value}`).join('; ');
 const applyCookies=(client,headers)=>{
  for(const cookie of headers.getSetCookie()){
   const pair=cookie.split(';',1)[0],equal=pair.indexOf('='),name=pair.slice(0,equal),value=pair.slice(equal+1);
   if(!value||/\bMax-Age=0\b/i.test(cookie))client.cookies.delete(name);else client.cookies.set(name,value);
  }
 };
 const call=async(client,path,body,extra={})=>{
  const headers={cookie:cookieHeader(client),...(body===undefined?{}:{origin,'Content-Type':'application/json'}),...extra.headers};
  for(const [key,value] of Object.entries(headers))if(value===null)delete headers[key];
  const request=new Request(origin+'/api/public-account/'+path,{method:body===undefined?'GET':'POST',headers,
   ...(body===undefined?{}:{body:typeof body==='string'?body:JSON.stringify(body)})});
  const response=await handlePublicAccountRequest(request,{db,config,clock:()=>now,emailFetcher,
   ...(extra.renderProfile?{renderProfile:extra.renderProfile}:{})});
  applyCookies(client,response.headers);
  const raw=await response.text();let parsed;try{parsed=JSON.parse(raw);}catch{parsed=raw;}
  return {status:response.status,body:parsed,headers:response.headers,raw};
 };
 const proof=email=>{
  const sent=mail.findLast(item=>item.to[0]===email);assert.ok(sent,'A code must come from the captured provider payload');
  assert.equal(sent.subject,'Код подтверждения ФСП');assert.equal(/https?:\/\/|www\.|\/account/i.test(sent.text),false,'New auth mail must contain no URLs');
  const code=sent.text.match(/\b([0-9]{8})\b/)?.[1];assert.ok(code,'The actual email must contain an eight-digit code');
  const request=db.sqlite.prepare('SELECT id FROM public_email_auth_requests WHERE email=? ORDER BY created_at DESC,rowid DESC LIMIT 1').get(email);
  assert.ok(request,'The challenge ID comes from the request record, never from a guessed code');
  return {challengeId:request.id,code};
 };
 const state=client=>call(client,'state');
 const action=async(client,input)=>{const result=await call(client,'action',input);success(result);return result.body;};
 const enroll=async(client,input=register())=>{
  success(await call(client,'auth/request',input));const challenge=proof(input.email.toLowerCase());
  success(await call(client,'auth/consume',challenge));const result=await state(client);success(result);return result.body;
 };
 const rows=table=>db.sqlite.prepare(`SELECT * FROM "${table}"`).all();
 return {db,config,mail,browser,cookieHeader,call,proof,state,action,enroll,rows,advance:ms=>{now+=ms;},now:()=>now};
}

test('public email flags default off and parse independently of the legacy Sites pilot',()=>{
 const off=publicEmailAuthConfiguration({});assert.equal(off.accountsEnabled,false);assert.equal(off.emailAuthEnabled,false);assert.equal(off.publicPilotEmails,undefined);
 const on=publicEmailAuthConfiguration({FSP_REAL_ACCOUNTS_ENABLED:'true',FSP_EMAIL_AUTH_ENABLED:'true',FSP_PUBLIC_ACCOUNT_PILOT_EMAILS:'[]',FSP_REAL_ACCOUNT_PILOT_SUBJECTS:'["legacy"]'});
 assert.equal(on.accountsEnabled,true);assert.equal(on.emailAuthEnabled,true);assert.equal(on.publicPilotEmails,'[]');assert.equal(on.pilotSubjects,'["legacy"]');
});

for(const privacyNoticeUrl of ['https://','https://[invalid]','http://email-auth.example.test/privacy','https://user:password@email-auth.example.test/privacy'])test(`unusable privacy policy fails before DB and mail (${privacyNoticeUrl})`,async()=>{
 let writes=0,mail=0;
 const db={prepare(){writes++;throw new Error('Must not reach DB');},batch(){writes++;throw new Error('Must not reach DB');}};
 const config={...base,privacyNoticeUrl};
 for(const [path,input] of [['state',undefined],['auth/request',register()]]){
  const request=new Request(origin+'/api/public-account/'+path,{method:input?'POST':'GET',headers:input?{origin,'Content-Type':'application/json'}:{},...(input?{body:JSON.stringify(input)}:{})});
  const response=await handlePublicAccountRequest(request,{db,config,emailFetcher:async()=>{mail++;throw new Error('Must not send');}});
  assert.equal(response.status,503);
 }
 assert.equal(writes,0);assert.equal(mail,0);
});

test('email registration creates no account until a same-browser code is consumed, then keeps secrets server-side',async()=>{
 const f=fixture(),candidate=f.browser();try{
  const initial=await f.state(candidate);success(initial);assert.equal(initial.body.enrolled,false);assert.equal(initial.body.user,null);assert.equal(initial.body.authMode,'email');
  const requested=await f.call(candidate,'auth/request',register());success(requested);assert.equal(requested.body.requested,true);
  assert.equal(f.mail.length,1);assert.equal(f.rows('real_accounts').length,0);assert.equal(f.rows('public_account_sessions').length,0);
  assert.ok(candidate.cookies.has('__Host-fsp_auth'));assert.equal(candidate.cookies.has('__Host-fsp_account'),false);
  const pending=requested.headers.getSetCookie().find(cookie=>cookie.startsWith('__Host-fsp_auth='));
  for(const attribute of ['Secure','HttpOnly','SameSite=Lax','Path=/'])assert.ok(pending.includes(attribute));assert.ok(!/\bDomain=/i.test(pending));
  const challenge=f.proof('candidate@example.test');assert.equal(requested.body.challengeId,challenge.challengeId);assert.equal(JSON.stringify(requested.body).includes(challenge.code),false);
  assert.equal(JSON.stringify(f.rows('public_email_auth_requests')).includes(challenge.code),false,'Only a code hash may be stored');
  const consumed=await f.call(candidate,'auth/consume',challenge);success(consumed);assert.equal(consumed.body.authMode,'email');
  assert.equal(candidate.cookies.has('__Host-fsp_auth'),false);assert.ok(candidate.cookies.has('__Host-fsp_account'));
  const session=consumed.headers.getSetCookie().find(cookie=>cookie.startsWith('__Host-fsp_account='));
  for(const attribute of ['Secure','HttpOnly','SameSite=Lax','Path=/'])assert.ok(session.includes(attribute));assert.ok(!/\bDomain=/i.test(session));
  assert.equal(JSON.stringify(f.rows('public_account_sessions')).includes(candidate.cookies.get('__Host-fsp_account')),false,'Store no raw session credential');
  const state=await f.state(candidate);success(state);assert.equal(state.body.enrolled,true);assert.equal(state.body.user.role,'candidate');assert.equal(state.body.user.email,'candidate@example.test');assert.equal(state.body.user.verified,true);
  assert.equal(state.body.accounts.length,1);assert.deepEqual(state.body.outbox,[]);
  for(const secret of [challenge.code,candidate.cookies.get('__Host-fsp_account'),base.tokenSecret,base.resendApiKey])assert.equal(state.raw.includes(secret),false);
  assert.equal(f.rows('real_accounts').length,1);assert.equal(f.mail.length,1);
 }finally{f.db.close();}
});

test('wrong code, wrong browser, expiry and replay never create extra accounts or sessions',async()=>{
 const f=fixture(),candidate=f.browser(),other=f.browser();try{
  success(await f.call(candidate,'auth/request',register()));const challenge=f.proof('candidate@example.test');
  assert.equal((await f.call(other,'auth/consume',challenge)).status,400);
  assert.equal((await f.call(candidate,'auth/consume',{...challenge,code:'not-the-secret'})).status,400);
  assert.equal(f.rows('real_accounts').length,0);assert.equal(f.rows('public_account_sessions').length,0);
  const pending=candidate.cookies.get('__Host-fsp_auth');
  success(await f.call(candidate,'auth/consume',challenge));
  other.cookies.set('__Host-fsp_auth',pending);
  assert.equal((await f.call(other,'auth/consume',challenge)).status,400,'Consumed codes cannot be replayed even with their original browser cookie');
  assert.equal(f.rows('real_accounts').length,1);assert.equal(f.rows('public_account_sessions').length,1);
  const expired=f.browser();success(await f.call(expired,'auth/request',register('expired@example.test')));const stale=f.proof('expired@example.test');
  f.advance(15*60*1000+1);assert.equal((await f.call(expired,'auth/consume',stale)).status,400);
  assert.equal(f.rows('real_accounts').length,1);assert.equal(f.rows('public_account_sessions').length,1);
 }finally{f.db.close();}
});

test('five valid-shaped incorrect code guesses lock the challenge before account creation',async()=>{
 const f=fixture(),candidate=f.browser();try{
  success(await f.call(candidate,'auth/request',register()));const challenge=f.proof('candidate@example.test');
  const wrong=(challenge.code[0]==='0'?'1':'0')+challenge.code.slice(1);
  for(let attempt=0;attempt<5;attempt++)assert.equal((await f.call(candidate,'auth/consume',{...challenge,code:wrong})).status,400);
  assert.equal((await f.call(candidate,'auth/consume',challenge)).status,400);
  assert.equal(f.rows('real_accounts').length,0);assert.equal(f.rows('public_account_sessions').length,0);assert.equal(f.mail.length,1);
 }finally{f.db.close();}
});

test('malformed codes and ambiguous proof fields cannot consume a challenge or use a guessing attempt',async()=>{
 const f=fixture(),candidate=f.browser();try{
  success(await f.call(candidate,'auth/request',register()));const challenge=f.proof('candidate@example.test');
  for(const code of ['',null,12345678,'1234567','123456789','12ab5678',' 12345678','12345678 ','１２３４５６７８']){
   assert.equal((await f.call(candidate,'auth/consume',{...challenge,code})).status,400);
  }
  for(const token of [null,'','a'.repeat(64)])assert.equal((await f.call(candidate,'auth/consume',{...challenge,token})).status,400,'Code plus token must be rejected, even when one field is empty');
  assert.equal((await f.call(candidate,'auth/consume',{challengeId:challenge.challengeId})).status,400);
  assert.equal(f.rows('public_email_auth_requests')[0].failed_attempts,0);
  assert.equal(f.rows('real_accounts').length,0);assert.equal(f.rows('public_account_sessions').length,0);
  success(await f.call(candidate,'auth/consume',challenge));assert.equal((await f.state(candidate)).body.enrolled,true);
 }finally{f.db.close();}
});

test('a legacy 64-hex link proof still consumes its existing hash-only request once in the original browser',async()=>{
 const f=fixture(),candidate=f.browser(),other=f.browser();try{
  success(await f.call(candidate,'auth/request',register()));const challenge=f.proof('candidate@example.test');
  // This represents a request created by the prior link-based deployment.
  const token='ab'.repeat(32),legacy={challengeId:challenge.challengeId,token};
  f.db.sqlite.prepare('UPDATE public_email_auth_requests SET token_hash=? WHERE id=?').run(await tokenHash(token),challenge.challengeId);
  assert.equal(JSON.stringify(f.rows('public_email_auth_requests')).includes(token),false);
  assert.equal((await f.call(other,'auth/consume',legacy)).status,400);
  const pending=candidate.cookies.get('__Host-fsp_auth');success(await f.call(candidate,'auth/consume',legacy));
  other.cookies.set('__Host-fsp_auth',pending);assert.equal((await f.call(other,'auth/consume',legacy)).status,400);
  assert.equal(f.rows('real_accounts').length,1);assert.equal(f.rows('public_account_sessions').length,1);
  assert.equal((await f.state(candidate)).body.user.verified,true);
 }finally{f.db.close();}
});

test('registration proof cannot enroll after the required privacy notice changes',async()=>{
 const config={...base},f=fixture(config),candidate=f.browser();try{
  success(await f.call(candidate,'auth/request',register()));const challenge=f.proof('candidate@example.test');
  config.privacyNoticeVersion='synthetic-v2';assert.equal((await f.call(candidate,'auth/consume',challenge)).status,400);
  assert.equal(f.rows('real_accounts').length,0);assert.equal(f.rows('public_account_sessions').length,0);assert.equal(f.mail.length,1);
 }finally{f.db.close();}
});

test('concurrent consumption has exactly one successful winner and one session',async()=>{
 const f=fixture(),candidate=f.browser();try{
  success(await f.call(candidate,'auth/request',register()));const challenge=f.proof('candidate@example.test');
  const parallel=f.browser();parallel.cookies=new Map(candidate.cookies);
  const results=await Promise.all([f.call(candidate,'auth/consume',challenge),f.call(parallel,'auth/consume',challenge)]);
  assert.equal(results.filter(result=>result.status===200).length,1,JSON.stringify(results.map(result=>({status:result.status,body:result.body}))));
  assert.ok(results.some(result=>[400,409].includes(result.status)));
  assert.equal(f.rows('real_accounts').length,1);assert.equal(f.rows('public_account_sessions').length,1);
 }finally{f.db.close();}
});

test('a failed session transaction rolls back account creation and proof consumption so the same proof can be retried',async()=>{
 const f=fixture(),candidate=f.browser();try{
  success(await f.call(candidate,'auth/request',register()));const challenge=f.proof('candidate@example.test');
  const before=JSON.stringify(f.rows('public_email_auth_requests'));
  f.db.failOnceWhen=/INSERT(?:\s+OR\s+\w+)?\s+INTO\s+[`"]?public_account_sessions/i;
  assert.ok([409,503].includes((await f.call(candidate,'auth/consume',challenge)).status));
  assert.equal(f.db.failOnceWhen,null,'The session write must be in the transactional batch');
  assert.equal(f.rows('real_accounts').length,0);assert.equal(f.rows('real_candidate_profiles').length,0);assert.equal(f.rows('public_account_sessions').length,0);
  assert.equal(JSON.stringify(f.rows('public_email_auth_requests')),before,'A storage failure must not burn the login code');
  success(await f.call(candidate,'auth/consume',challenge));assert.equal((await f.state(candidate)).body.enrolled,true);assert.equal(f.mail.length,1);
 }finally{f.db.close();}
});

test('email login preserves canonical account identity and role despite forged registration fields',async()=>{
 const f=fixture(),candidate=f.browser();try{
  const before=await f.enroll(candidate);success(await f.call(candidate,'auth/logout',{}));f.advance(61*1000);
  success(await f.call(candidate,'auth/request',{...login('CANDIDATE@EXAMPLE.TEST'),role:'employer',name:'Forged employer',principal:{issuer:'sites-chatgpt',subject:'owner'},actor:'demo-employer'}));
  success(await f.call(candidate,'auth/consume',f.proof('candidate@example.test')));
  const after=(await f.state(candidate)).body;assert.equal(after.user.id,before.user.id);assert.equal(after.user.role,'candidate');assert.equal(after.user.name,before.user.name);
  assert.equal(f.rows('real_accounts').length,1);assert.equal(f.rows('real_employer_profiles').length,0);
  assert.equal((await f.call(candidate,'action',{action:'search',role:'employer',actor:'demo-employer'})).status,403);
  success(await f.call(candidate,'auth/logout',{}));f.advance(61*1000);
  success(await f.call(candidate,'auth/request',{...register('candidate@example.test','employer'),name:'Re-registration must not replace identity'}));
  success(await f.call(candidate,'auth/consume',f.proof('candidate@example.test')));
  const reregistered=(await f.state(candidate)).body;
  assert.equal(reregistered.user.id,before.user.id);assert.equal(reregistered.user.role,'candidate');assert.equal(reregistered.user.name,before.user.name);
  assert.equal(f.rows('real_accounts').length,1);assert.equal(f.rows('real_employer_profiles').length,0);
 }finally{f.db.close();}
});

test('logout revokes the server session and expiry denies stale cookies without sending mail',async()=>{
 const f=fixture(),candidate=f.browser(),replay=f.browser();try{
  await f.enroll(candidate);replay.cookies=new Map(candidate.cookies);
  const loggedOut=await f.call(candidate,'auth/logout',{});success(loggedOut);assert.equal(candidate.cookies.has('__Host-fsp_account'),false);
  assert.equal((await f.state(replay)).body.enrolled,false);assert.equal((await f.call(replay,'action',{action:'profile',consent:true,published:true})).status,401);
  assert.equal((await f.call(replay,'profile.pdf')).status,401);
  f.advance(61*1000);success(await f.call(candidate,'auth/request',login('candidate@example.test')));success(await f.call(candidate,'auth/consume',f.proof('candidate@example.test')));
  f.advance(24*60*60*1000+1);assert.equal((await f.state(candidate)).body.enrolled,false);
  assert.equal((await f.call(candidate,'action',{action:'profile'})).status,401);assert.equal(f.mail.length,2);
 }finally{f.db.close();}
});

test('request, consume, logout and role writes reject absent or foreign Origin before changing data',async()=>{
 const f=fixture(),candidate=f.browser();try{
  success(await f.call(candidate,'auth/request',register()));const challenge=f.proof('candidate@example.test');
  const tables=['real_accounts','public_email_auth_requests','public_account_sessions'];
  const snapshot=()=>JSON.stringify(tables.map(table=>f.rows(table)));
  const before=snapshot();
  for(const source of [null, '', 'https://untrusted.example.test'])for(const [path,body] of [['auth/request',register('other@example.test')],['auth/consume',challenge],['auth/logout',{}],['action',{action:'profile'}]]){
   assert.equal((await f.call(candidate,path,body,{headers:{origin:source}})).status,403);
  }
  assert.equal(snapshot(),before);assert.equal(f.mail.length,1);
  success(await f.call(candidate,'auth/consume',challenge));assert.equal((await f.call(candidate,'auth/logout',{}, {headers:{origin:'https://untrusted.example.test'}})).status,403);
  assert.equal((await f.state(candidate)).body.enrolled,true,'Rejected logout leaves the real session active');
 }finally{f.db.close();}
});

test('GET requests never dispatch email, consume links or revoke sessions',async()=>{
 const f=fixture(),candidate=f.browser();try{
  success(await f.call(candidate,'auth/request',register()));const challenge=f.proof('candidate@example.test');
  for(const path of ['auth/request','auth/consume','auth/logout','action'])denied(await f.call(candidate,path));
  assert.equal(f.rows('real_accounts').length,0);assert.equal(f.rows('public_account_sessions').length,0);assert.equal(f.mail.length,1);
  success(await f.call(candidate,'auth/consume',challenge));denied(await f.call(candidate,'auth/logout'));assert.equal((await f.state(candidate)).body.enrolled,true);
  assert.equal(f.mail.length,1);
 }finally{f.db.close();}
});

for(const disabled of [{accountsEnabled:false},{emailAuthEnabled:false}]){
 test(`disabled public authentication has no database, mail or PDF effects (${JSON.stringify(disabled)})`,async()=>{
  let databaseCalls=0,mailCalls=0,pdfCalls=0;
  const db={prepare(){databaseCalls++;throw new Error('Disabled mode touched DB');},batch(){databaseCalls++;throw new Error('Disabled mode touched DB');}};
  const config={...base,...disabled};
  const call=async(path,body)=>handlePublicAccountRequest(new Request(origin+'/api/public-account/'+path,{method:body?'POST':'GET',headers:{origin,'Content-Type':'application/json',cookie:'__Host-fsp_account=forged'},...(body?{body:JSON.stringify(body)}:{})}),{db,config,emailFetcher:async()=>{mailCalls++;throw new Error('Disabled mode sent mail');},renderProfile:async()=>{pdfCalls++;return new Uint8Array();}});
  const state=await call('state');assert.equal(state.status,200);assert.equal((await state.json()).enabled,false);
  for(const [path,body] of [['auth/request',register()],['auth/consume',{challengeId:'forged',token:'forged'}],['action',{action:'profile'}],['profile.pdf',undefined]])assert.equal((await call(path,body)).status,503);
  assert.equal(databaseCalls,0);assert.equal(mailCalls,0);assert.equal(pdfCalls,0);
 });
}

test('email delivery switched off rejects link requests before DB or provider access',async()=>{
 let databaseCalls=0,mailCalls=0;
 const db={prepare(){databaseCalls++;throw new Error('Disabled delivery touched DB');},batch(){databaseCalls++;throw new Error('Disabled delivery touched DB');}};
 const response=await handlePublicAccountRequest(new Request(origin+'/api/public-account/auth/request',{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify(register())}),{db,config:{...base,emailMode:'off'},emailFetcher:async()=>{mailCalls++;throw new Error('Disabled delivery sent mail');}});
 assert.equal(response.status,503);assert.equal(databaseCalls,0);assert.equal(mailCalls,0);
});

for(const allowlist of ['', 'not-json', '[]', '{}', '[42]', '[" candidate@example.test"]', '["invalid"]']){
 test(`malformed public pilot is closed before DB or delivery (${allowlist})`,async()=>{
  let databaseCalls=0,mailCalls=0;
  const db={prepare(){databaseCalls++;throw new Error('Malformed pilot touched DB');},batch(){databaseCalls++;throw new Error('Malformed pilot touched DB');}};
  const response=await handlePublicAccountRequest(new Request(origin+'/api/public-account/auth/request',{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify(register())}),{db,config:{...base,publicPilotEmails:allowlist},emailFetcher:async()=>{mailCalls++;throw new Error('Malformed pilot sent mail');}});
  assert.equal(response.status,503);assert.equal(databaseCalls,0);assert.equal(mailCalls,0);
 });
}

test('public email pilot rejects unlisted addresses and revocation closes sessions and PDF immediately',async()=>{
 const config={...base,publicPilotEmails:JSON.stringify(['candidate@example.test'])},f=fixture(config),candidate=f.browser();try{
  assert.equal((await f.call(candidate,'auth/request',{...register('outsider@example.test'),email:'outsider@example.test',actor:'candidate@example.test'})).status,403);
  assert.equal(f.mail.length,0);assert.equal(f.rows('real_accounts').length,0);
  await f.enroll(candidate);config.publicPilotEmails=JSON.stringify(['different@example.test']);
  assert.equal((await f.state(candidate)).status,403);assert.equal((await f.call(candidate,'action',{action:'profile'})).status,403);
  assert.equal((await f.call(candidate,'profile.pdf',undefined,{renderProfile:async()=>{assert.fail('Revoked identity reached PDF');}})).status,403);
  assert.equal(f.rows('real_accounts').length,1);assert.equal(f.mail.length,1);
 }finally{f.db.close();}
});

test('per-email cooldown rejects duplicate mail then allows a fresh challenge after a minute',async()=>{
 const f=fixture(),candidate=f.browser();try{
  success(await f.call(candidate,'auth/request',register()));assert.equal((await f.call(candidate,'auth/request',register())).status,429);assert.equal(f.mail.length,1);
  f.advance(61*1000);success(await f.call(candidate,'auth/request',register()));assert.equal(f.mail.length,2);assert.equal(f.rows('real_accounts').length,0);
 }finally{f.db.close();}
});

test('five hourly requests cap delivery even when each request passes the one-minute cooldown',async()=>{
 const f=fixture(),candidate=f.browser();try{
  for(let i=0;i<5;i++){success(await f.call(candidate,'auth/request',register()));f.advance(61*1000);}
  assert.equal((await f.call(candidate,'auth/request',register())).status,429);assert.equal(f.mail.length,5);
  assert.equal(f.rows('real_accounts').length,0);assert.equal(f.rows('public_account_sessions').length,0);
 }finally{f.db.close();}
});

test('global minute limit bounds mail even when attackers rotate valid recipient emails',async()=>{
 const f=fixture(),client=f.browser();try{
  for(let attempt=0;attempt<30;attempt++)success(await f.call(client,'auth/request',register(`synthetic-${attempt}@example.test`)));
  assert.equal((await f.call(client,'auth/request',register('synthetic-blocked@example.test'))).status,429);
  assert.equal(f.mail.length,30);assert.equal(f.rows('real_accounts').length,0);
  f.advance(61*1000);success(await f.call(client,'auth/request',register('synthetic-after-window@example.test')));assert.equal(f.mail.length,31);
 }finally{f.db.close();}
});

test('received login proof remains valid when provider acceptance is ambiguous',async()=>{
 const f=fixture({...base},{delivery:async()=>{throw new Error('Synthetic connection ended after provider accepted the message');}}),candidate=f.browser();try{
  const requested=await f.call(candidate,'auth/request',register());assert.ok([200,503].includes(requested.status));assert.equal(f.mail.length,1);
  assert.equal(f.rows('real_accounts').length,0);
  success(await f.call(candidate,'auth/consume',f.proof('candidate@example.test')));
  assert.equal((await f.state(candidate)).body.user.verified,true);assert.equal(f.mail.length,1);
 }finally{f.db.close();}
});

test('login alone never creates an account for an unknown email',async()=>{
 const f=fixture(),unknown=f.browser();try{
  const requested=await f.call(unknown,'auth/request',login('unknown@example.test'));success(requested);assert.equal(requested.body.requested,true);
  assert.equal(f.rows('real_accounts').length,0);assert.equal(f.rows('public_account_sessions').length,0);
  assert.equal((await f.state(unknown)).body.enrolled,false);assert.equal(f.mail.length,1);
  assert.equal((await f.call(unknown,'auth/consume',f.proof('unknown@example.test'))).status,400);
  assert.equal(f.rows('real_accounts').length,0);assert.equal(f.rows('public_account_sessions').length,0);
 }finally{f.db.close();}
});

test('email authentication cannot silently link a legacy Sites identity with the same address',async()=>{
 const f=fixture(),candidate=f.browser();try{
  f.db.sqlite.prepare('INSERT INTO real_accounts(id,issuer,subject,role,email,name,privacy_accepted_at,privacy_notice_version,email_verified_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
   .run('legacy-account','sites-chatgpt','legacy-subject','candidate','candidate@example.test','Legacy synthetic user',f.now(),'synthetic-v1',f.now(),f.now());
  f.db.sqlite.prepare('INSERT INTO real_candidate_profiles(account_id) VALUES (?)').run('legacy-account');
  const before=JSON.stringify(f.rows('real_accounts'));
  success(await f.call(candidate,'auth/request',login('candidate@example.test')));
  assert.equal(f.mail.length,1);assert.equal((await f.state(candidate)).body.enrolled,false);
  assert.equal((await f.call(candidate,'auth/consume',f.proof('candidate@example.test'))).status,400);
  f.advance(61*1000);success(await f.call(candidate,'auth/request',register()));
  assert.equal((await f.call(candidate,'auth/consume',f.proof('candidate@example.test'))).status,400);
  assert.equal(f.mail.length,2);assert.equal(f.rows('public_account_sessions').length,0);assert.equal(JSON.stringify(f.rows('real_accounts')),before);
 }finally{f.db.close();}
});

test('public email sessions do not widen the existing Sites principal pilot',async()=>{
 const config={...base,pilotSubjects:JSON.stringify(['legacy-allowed'])},f=fixture(config),candidate=f.browser();try{
  const own=await f.enroll(candidate);
  const oldRequest=new Request(origin+'/api/account/state',{headers:{cookie:f.cookieHeader(candidate)}});
  const unauthenticated=await handleAccountRequest(oldRequest,{principal:null,db:f.db,config});assert.equal(unauthenticated.status,401);
  const wrongChannel=await handleAccountRequest(oldRequest,{principal:{issuer:'fsp-email',subject:own.user.id},db:f.db,config});assert.equal(wrongChannel.status,403);
  const legacy=await handleAccountRequest(oldRequest,{principal:{issuer:'sites-chatgpt',subject:'legacy-allowed'},db:f.db,config});assert.equal(legacy.status,200);assert.equal((await legacy.json()).enrolled,false);
  assert.equal((await f.state(candidate)).body.user.id,own.user.id);assert.equal(f.mail.length,1);
 }finally{f.db.close();}
});

for(const invalid of [{role:'owner'},{name:'x'},{email:'invalid'},{dataConsent:false},{privacyNoticeVersion:'old-version'}]){
 test(`registration validation fails before account creation or mail (${JSON.stringify(invalid)})`,async()=>{
  const f=fixture(),candidate=f.browser();try{
   assert.equal((await f.call(candidate,'auth/request',{...register(),...invalid})).status,400);
   assert.equal(f.rows('real_accounts').length,0);assert.equal(f.rows('public_account_sessions').length,0);assert.equal(f.mail.length,0);
  }finally{f.db.close();}
 });
}

test('malformed and oversized auth bodies have stable errors without sending mail',async()=>{
 const f=fixture(),candidate=f.browser();try{
  assert.equal((await f.call(candidate,'auth/request','{')).status,400);
  assert.equal((await f.call(candidate,'auth/request',{...register(),name:'Я'.repeat(9000)})).status,413);
  assert.equal(f.rows('real_accounts').length,0);assert.equal(f.mail.length,0);
 }finally{f.db.close();}
});

test('session cookie and client hints cannot impersonate an account or expose another PDF',async()=>{
 const f=fixture(),candidate=f.browser(),employer=f.browser(),forged=f.browser();try{
  const own=await f.enroll(candidate);const company=await f.enroll(employer,register('employer@example.test','employer'));
  const hints={actor:own.user.id,principal:{issuer:'fsp-email',subject:'candidate@example.test'},role:'candidate',email:'candidate@example.test'};
  forged.cookies.set('__Host-fsp_account',own.user.id);forged.cookies.set('fsp_actor',own.user.id);
  const anonymous=await f.state(forged);success(anonymous);assert.equal(anonymous.body.enrolled,false);
  assert.equal((await f.call(forged,'action',{action:'profile',...hints})).status,401);
  const duplicate=await f.call(candidate,'state',undefined,{headers:{cookie:f.cookieHeader(candidate)+'; __Host-fsp_account='+'a'.repeat(64)}});
  assert.equal(duplicate.body.enrolled,false,'Ambiguous duplicate session cookies fail closed');
  assert.equal((await f.call(employer,'action',{action:'profile',...hints})).status,403);
  assert.equal((await f.call(employer,'profile.pdf',undefined,{renderProfile:async()=>{assert.fail('Employer reached candidate PDF');}})).status,403);
  let rendered;
  const pdf=await f.call(candidate,'profile.pdf?candidateId='+company.user.id,undefined,{renderProfile:async user=>{rendered=user;return new TextEncoder().encode('%PDF-synthetic');}});
  assert.equal(pdf.status,200);assert.equal(pdf.headers.get('Content-Type'),'application/pdf');assert.equal(rendered.id,own.user.id);
  const candidateState=(await f.state(candidate)).body,employerState=(await f.state(employer)).body;
  assert.equal(candidateState.accounts.length,1);assert.equal(employerState.accounts.length,1);assert.equal(candidateState.user.id,own.user.id);assert.equal(employerState.user.id,company.user.id);
  assert.notEqual(candidateState.draftIdentity,employerState.draftIdentity);assert.match(candidateState.draftIdentity,/^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(candidateState).includes('employer@example.test'),false);assert.equal(JSON.stringify(employerState).includes('candidate@example.test'),false);
 }finally{f.db.close();}
});

test('independent email sessions complete private hiring and immediately hide withdrawn contacts',async()=>{
 const f=fixture(),candidate=f.browser(),employer=f.browser(),outsider=f.browser();try{
  const own=await f.enroll(candidate);await f.enroll(employer,register('employer@example.test','employer'));
  await f.action(candidate,{action:'profile',about:'Synthetic backend engineer',experience:2,softSkills:'Teamwork',consent:true,published:true,contact:'forged@example.test',grade:'Senior',score:100});
  assert.equal((await f.action(employer,{action:'search'})).candidates.length,0,'Client profile claims cannot grant a category');
  const started=await f.action(candidate,{action:'test-start',specialization:'Backend',grade:'Junior'});
  for(const question of started.test.questions){assert.equal(question.answer,undefined);assert.equal(question.alternatives,undefined);}
  const stored=await f.db.prepare('SELECT questions_json FROM real_assessments WHERE id=?').bind(started.test.id).first();
  const answers=Object.fromEntries(JSON.parse(stored.questions_json).map(question=>[question.id,question.answer]));
  f.advance(1);assert.equal((await f.action(candidate,{action:'test-submit',testId:started.test.id,answers})).passed,true);
  await f.action(employer,{action:'company',company:'Synthetic employer',description:'Backend team',contact:'forged@example.test'});
  const found=await f.action(employer,{action:'search',specialization:'Backend',grade:'Junior',need:'Python SQL'});
  assert.equal(found.candidates.length,1);assert.equal(found.candidates[0].email,undefined);assert.equal(found.candidates[0].contact,undefined);
  const invitation=(await f.action(employer,{action:'invite',candidateId:own.user.id,salaryFrom:100000,salaryTo:150000,salaryBasis:'net',description:'Synthetic backend invitation'})).invitation;
  assert.equal(invitation.employerContact,'employer@example.test');
  assert.equal((await f.state(employer)).body.invitations[0].candidateContact,undefined);
  await f.action(candidate,{action:'invitation-status',id:invitation.id,status:'accepted'});
  assert.equal((await f.state(employer)).body.invitations[0].candidateContact,'candidate@example.test');
  await f.enroll(outsider,register('outsider@example.test','employer'));const other=await f.action(outsider,{action:'search'});
  assert.equal(other.candidates.length,1);assert.equal(other.candidates[0].contact,undefined);assert.equal((await f.state(outsider)).body.invitations.length,0);
  await f.action(candidate,{action:'profile',consent:false,published:false});
  assert.equal((await f.state(employer)).body.invitations[0].candidateContact,undefined);
  assert.equal((await f.action(employer,{action:'search'})).candidates.length,0);assert.equal(f.mail.length,3);
 }finally{f.db.close();}
});
