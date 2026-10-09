import { DomainError } from './domain.mjs';
import { assertTransportConfiguration, emailTransport, GOOGLE_MAIL_TRANSPORT, payloadIdentity, sendVerification, verificationPayload } from './email-transport.mjs';
const bytes=value=>new TextEncoder().encode(value);
const hex=value=>Array.from(new Uint8Array(value)).map(byte=>byte.toString(16).padStart(2,'0')).join('');
export const tokenHash=async token=>hex(await crypto.subtle.digest('SHA-256',bytes(token)));
export async function challengeToken(secret,challenge){
  if(typeof secret!=='string'||secret.length<32)throw new DomainError('Проверка email ещё не настроена.',503);
  const key=await crypto.subtle.importKey('raw',bytes(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return hex(await crypto.subtle.sign('HMAC',key,bytes(JSON.stringify(['fsp-email-v1',challenge.id,challenge.account_id,challenge.recipient,challenge.expires_at]))));
}
export function equalHash(a,b){if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let difference=0;for(let i=0;i<a.length;i++)difference|=a.charCodeAt(i)^b.charCodeAt(i);return difference===0;}
export async function buildEmailChallenge(account,config,now=Date.now()){
  assertEmailDeliveryConfiguration(config);
  const challenge={id:crypto.randomUUID(),account_id:account.id,recipient:account.email,token_hash:'',created_at:now,expires_at:now+15*60000,consumed_at:null,failed_attempts:0,delivery_state:'pending'};
  challenge.token_hash=await tokenHash(await challengeToken(config.tokenSecret,challenge));
  const outbox={id:crypto.randomUUID(),email_transport:emailTransport(config),challenge_id:challenge.id,status:config.emailMode==='live'?'queued':'blocked',attempts:0,next_attempt_at:now,lease_id:null,lease_until:null,last_error_code:null,provider_message_id:null,payload_hash:config.emailMode==='live'?await tokenHash(payloadIdentity(config,verificationPayload(config,challenge,await challengeToken(config.tokenSecret,challenge)))):null,created_at:now,sent_at:null};
  return {challenge,outbox};
}
export async function assertEmailRateLimit(db,accountId,now){const latest=await db.prepare('SELECT created_at FROM real_email_challenges WHERE account_id=? ORDER BY created_at DESC LIMIT 1').bind(accountId).first();if(latest&&now-latest.created_at<60000)throw new DomainError('Повторное письмо доступно через минуту.',429);const count=await db.prepare('SELECT COUNT(*) AS total FROM real_email_challenges WHERE account_id=? AND created_at>?').bind(accountId,now-3600000).first();if(count.total>=5)throw new DomainError('Не больше пяти запросов письма в час.',429);}
export function emailRecordStatements(repository,records,operation){return [repository.guardedInsert('real_email_challenges',records.challenge,['id'],operation),repository.guardedInsert('real_email_outbox',records.outbox,['id'],operation)];}
export async function requestVerification(repository,snapshot,account,config,now=Date.now()){
  if(account.email_verified_at!==null)return {emailStatus:'verified'};
  await assertEmailRateLimit(repository.db,account.id,now);const records=await buildEmailChallenge(account,config,now);
  await repository.transaction(snapshot.revision,operation=>emailRecordStatements(repository,records,operation));
  return accountEmailStatus(repository.db,account,config,now,records.challenge.id);
}
export async function verifyAccountEmail(repository,snapshot,account,input,now=Date.now()){
  const challenge=await repository.db.prepare('SELECT * FROM real_email_challenges WHERE id=? AND account_id=?').bind(String(input.challengeId||''),account.id).first();
  if(!challenge||challenge.recipient!==account.email||challenge.consumed_at!==null||challenge.expires_at<=now||challenge.failed_attempts>=5||challenge.delivery_state!=='sent')throw new DomainError('Ссылка подтверждения недоступна или истекла.',400);
  const supplied=await tokenHash(String(input.token||'').slice(0,128));
  if(!equalHash(challenge.token_hash,supplied)){
    await repository.transaction(snapshot.revision,operation=>[repository.db.prepare("UPDATE real_email_challenges SET failed_attempts=MIN(5,failed_attempts+1) WHERE id=? AND consumed_at IS NULL AND EXISTS(SELECT 1 FROM real_revisions WHERE id='main' AND op_id=?)").bind(challenge.id,operation)]);
    return {verificationError:'Неверная ссылка подтверждения.'};
  }
  const results=await repository.transaction(snapshot.revision,operation=>[
    repository.db.prepare("UPDATE real_email_challenges SET consumed_at=? WHERE id=? AND account_id=? AND consumed_at IS NULL AND expires_at>? AND failed_attempts<5 AND delivery_state='sent' AND EXISTS(SELECT 1 FROM real_revisions WHERE id='main' AND op_id=?)").bind(now,challenge.id,account.id,now,operation),
    repository.db.prepare("UPDATE real_accounts SET email_verified_at=? WHERE id=? AND email=? AND EXISTS(SELECT 1 FROM real_email_challenges WHERE id=? AND consumed_at=? AND delivery_state='sent') AND EXISTS(SELECT 1 FROM real_revisions WHERE id='main' AND op_id=?)").bind(now,account.id,challenge.recipient,challenge.id,now,operation),
  ]);
  if(results[1].meta.changes!==1||results[2].meta.changes!==1)throw new DomainError('Ссылка подтверждения недоступна или истекла.',400);
  return {emailStatus:'verified'};
}
export function assertEmailDeliveryConfiguration(config){
  if(config.emailMode!=='live')return false;
  assertTransportConfiguration(config);
  if(typeof config.siteOrigin!=='string'||!config.siteOrigin.trim()||typeof config.tokenSecret!=='string'||config.tokenSecret.length<32||!config.tokenSecret.trim())throw new DomainError('Отправка email не настроена полностью.',503);
  let origin;
  try{origin=new URL(config.siteOrigin);}catch{throw new DomainError('Некорректный адрес сервиса.',503);}
  if(origin.protocol!=='https:'||origin.pathname!=='/'||origin.search||origin.hash||origin.username||origin.password)throw new DomainError('Некорректный адрес сервиса.',503);
  return true;
}
// Delivery status is safe to return to the owning principal. It contains no
// recipient, provider body, token, payload, lease ID, or credential.
export async function accountEmailStatus(db,account,config,now=Date.now(),challengeId=null){
  if(account.email_verified_at!==null)return {emailStatus:'verified',emailRetryAllowed:false};
  const job=await db.prepare(`SELECT o.*,c.expires_at,c.consumed_at,c.failed_attempts,c.delivery_state,c.recipient FROM real_email_outbox o JOIN real_email_challenges c ON c.id=o.challenge_id WHERE c.account_id=? ${challengeId?'AND c.id=?':''} ORDER BY c.created_at DESC,c.id DESC LIMIT 1`).bind(account.id,...(challengeId?[challengeId]:[])).first();
  if(!job)return {emailStatus:'not_requested',emailRetryAllowed:false};
  const unavailable=job.expires_at<=now||job.consumed_at!==null||job.failed_attempts>=5||job.recipient!==account.email;
  const ambiguous=job.last_error_code==='DELIVERY_UNKNOWN'||(job.email_transport===GOOGLE_MAIL_TRANSPORT&&job.status==='leased'&&job.lease_until<=now);
  const retryable=!ambiguous&&!unavailable&&job.attempts<5&&['queued','retry','leased'].includes(job.status);
  const retryAt=job.status==='leased'?job.lease_until:job.next_attempt_at;
  const exhausted=job.attempts>=5&&['queued','retry','leased'].includes(job.status)&&!(job.status==='leased'&&job.lease_until>now);
  return {emailStatus:ambiguous?'unknown':unavailable?'cancelled':exhausted?'failed':job.status,challengeId:job.challenge_id,expiresAt:job.expires_at,emailAttempts:job.attempts,emailRetryAllowed:config.emailMode==='live'&&retryable,...(retryable?{emailRetryAt:retryAt}: {})};
}
const jobSelect=`SELECT o.*,c.account_id,c.recipient,c.token_hash,c.expires_at,c.consumed_at,c.failed_attempts,c.delivery_state,a.email AS account_email,a.email_verified_at FROM real_email_outbox o JOIN real_email_challenges c ON c.id=o.challenge_id JOIN real_accounts a ON a.id=c.account_id`;
const due="((status IN ('queued','retry') AND next_attempt_at<=?) OR (status='leased' AND lease_until<=?))";
// Recheck fresh eligibility before transport and atomically on acceptance.
// Newer accepted links win when an older in-flight provider call finishes later.
const usable=`EXISTS(SELECT 1 FROM real_email_challenges c JOIN real_accounts a ON a.id=c.account_id WHERE c.id=real_email_outbox.challenge_id AND a.email=c.recipient AND a.email_verified_at IS NULL AND c.consumed_at IS NULL AND c.failed_attempts<5 AND c.expires_at>? AND c.delivery_state='pending')`;
const newest=`NOT EXISTS(SELECT 1 FROM real_email_challenges newer JOIN real_email_challenges current ON current.account_id=newer.account_id WHERE current.id=real_email_outbox.challenge_id AND newer.created_at>current.created_at)`;
async function dispatchJob(db,config,job,{clock,fetcher}){
  const now=clock();
  // Terminal jobs and active leases are never reopened, including by replay.
  if(!['queued','retry','leased'].includes(job.status)||(job.status==='leased'?job.lease_until>now:job.next_attempt_at>now))return {processed:0,sent:0};
  // MailApp has no provider idempotency or send receipt lookup. A worker may
  // have died after sending; an expired Google lease must never be replayed.
  if(job.email_transport===GOOGLE_MAIL_TRANSPORT&&job.status==='leased'){
    await db.prepare("UPDATE real_email_outbox SET status='failed',lease_until=NULL,last_error_code='DELIVERY_UNKNOWN' WHERE id=? AND status='leased' AND lease_until<=?").bind(job.id,now).run();
    return {processed:1,sent:0};
  }
  if(job.email_transport!==emailTransport(config)){
    await db.prepare(`UPDATE real_email_outbox SET status='failed',lease_until=NULL,last_error_code='TRANSPORT_CHANGED' WHERE id=? AND ${due}`).bind(job.id,now,now).run();
    return {processed:1,sent:0};
  }
  if(job.attempts>=5){
    await db.prepare(`UPDATE real_email_outbox SET status='failed',lease_until=NULL,last_error_code='ATTEMPTS_EXHAUSTED' WHERE id=? AND attempts>=5 AND ${due}`).bind(job.id,now,now).run();
    return {processed:0,sent:0};
  }
  const lease=crypto.randomUUID();
  const claim=await db.prepare(`UPDATE real_email_outbox SET status='leased',lease_id=?,lease_until=?,attempts=attempts+1 WHERE id=? AND attempts=? AND attempts<5 AND ${due}`).bind(lease,now+60000,job.id,job.attempts,now,now).run();
  if(claim.meta.changes!==1)return {processed:0,sent:0};
  const finish=async(status,code)=>db.prepare("UPDATE real_email_outbox SET status=?,lease_until=NULL,last_error_code=? WHERE id=? AND lease_id=? AND status='leased'").bind(status,code,job.id,lease).run();
  // Check fresh SQL state after the lease, not an account snapshot taken before
  // an awaited registration, resend, or verification transaction.
  const valid=()=>{const at=clock();return db.prepare(`SELECT id FROM real_email_outbox WHERE id=? AND lease_id=? AND status='leased' AND lease_until>? AND ${usable} AND ${newest}`).bind(job.id,lease,at,at).first();};
  if(!await valid()){await finish('cancelled','CHALLENGE_UNAVAILABLE');return {processed:1,sent:0};}
  const challenge={id:job.challenge_id,account_id:job.account_id,recipient:job.recipient,expires_at:job.expires_at};
  const token=await challengeToken(config.tokenSecret,challenge);
  if(!equalHash(await tokenHash(token),job.token_hash)){await finish('failed','TOKEN_KEY_CHANGED');return {processed:1,sent:0};}
  const payload=verificationPayload(config,challenge,token),payloadHash=await tokenHash(payloadIdentity(config,payload));
  // Legacy rows can be initialized only before any possible provider call.
  // An ambiguous attempt without a fingerprint cannot safely be reconstructed.
  if(job.payload_hash===null&&job.attempts===0){
    await db.prepare("UPDATE real_email_outbox SET payload_hash=? WHERE id=? AND lease_id=? AND status='leased' AND payload_hash IS NULL").bind(payloadHash,job.id,lease).run();
  }else if(!equalHash(payloadHash,job.payload_hash)){
    await finish('failed',job.payload_hash===null?'PAYLOAD_UNAVAILABLE':'PAYLOAD_CHANGED');return {processed:1,sent:0};
  }
  if(!await valid()){await finish('cancelled','CHALLENGE_UNAVAILABLE');return {processed:1,sent:0};}
  const result=await sendVerification(config,job,payload,fetcher,clock()),finishedAt=clock();
  if(result.accepted){
    const results=await db.batch([
      db.prepare(`UPDATE real_email_outbox SET status='sent',provider_message_id=?,sent_at=?,lease_until=NULL,last_error_code=NULL WHERE id=? AND lease_id=? AND status='leased' AND ${usable}`).bind(result.providerId,finishedAt,job.id,lease,finishedAt),
      db.prepare("UPDATE real_email_challenges SET delivery_state='sent' WHERE id=? AND EXISTS(SELECT 1 FROM real_email_outbox WHERE id=? AND lease_id=? AND status='sent')").bind(job.challenge_id,job.id,lease),
      db.prepare("UPDATE real_email_challenges SET consumed_at=?,delivery_state='superseded' WHERE account_id=? AND id<>? AND created_at<=? AND consumed_at IS NULL AND EXISTS(SELECT 1 FROM real_email_outbox WHERE id=? AND lease_id=? AND status='sent')").bind(finishedAt,job.account_id,job.challenge_id,job.created_at,job.id,lease),
    ]);
    if(results[0].meta.changes!==1)await finish('cancelled','CHALLENGE_UNAVAILABLE');
    return {processed:1,sent:results[0].meta.changes===1?1:0};
  }
  if(result.errorCode==='DELIVERY_UNKNOWN'){await finish('failed','DELIVERY_UNKNOWN');return {processed:1,sent:0};}
  if(!await valid()){await finish('cancelled','CHALLENGE_UNAVAILABLE');return {processed:1,sent:0};}
  const attempts=job.attempts+1,status=result.retryable&&attempts<5?'retry':'failed';
  await db.prepare("UPDATE real_email_outbox SET status=?,next_attempt_at=?,lease_until=NULL,last_error_code=? WHERE id=? AND lease_id=? AND status='leased'").bind(status,finishedAt+Math.min(300000,60000*2**(attempts-1)),result.errorCode,job.id,lease).run();
  return {processed:1,sent:0};
}
// Only server-selected challenge IDs reach this function. SQL binds the target
// again to the trusted principal: no account/recipient from request JSON is used.
export async function dispatchAccountEmail(db,config,{principal,challengeId,clock=Date.now,fetcher=fetch}){
  const account=await db.prepare('SELECT * FROM real_accounts WHERE issuer=? AND subject=?').bind(principal.issuer,principal.subject).first();
  if(!account)throw new DomainError('Сначала создайте собственный аккаунт.',403);
  const job=await db.prepare(`${jobSelect} WHERE c.id=? AND c.account_id=?`).bind(challengeId,account.id).first();
  if(!job)throw new DomainError('Запрос подтверждения недоступен.',403);
  if(account.email_verified_at===null&&assertEmailDeliveryConfiguration(config))await dispatchJob(db,config,job,{clock,fetcher});
  const current=await db.prepare('SELECT * FROM real_accounts WHERE id=?').bind(account.id).first();
  if(!current)throw new DomainError('Аккаунт недоступен.',403);
  return accountEmailStatus(db,current,config,clock(),challengeId);
}
// No timer, cron, or public/global endpoint activates this future worker.
export async function drainEmailOutbox(db,config,{now=Date.now(),limit=5,fetcher=fetch,clock=()=>now}={}){
  if(!assertEmailDeliveryConfiguration(config))return {enabled:false,processed:0,sent:0};
  const summary={enabled:true,processed:0,sent:0};
  for(let index=0;index<Math.min(10,Math.max(0,limit));index++){
    const at=clock();
    const job=await db.prepare(`${jobSelect} WHERE ((o.status IN ('queued','retry') AND o.next_attempt_at<=?) OR (o.status='leased' AND o.lease_until<=?)) ORDER BY o.created_at LIMIT 1`).bind(at,at).first();
    if(!job)break;
    const result=await dispatchJob(db,config,job,{clock,fetcher});summary.processed+=result.processed;summary.sent+=result.sent;
  }
  return summary;
}
