import { DomainError } from './domain.mjs';
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
  const outbox={id:crypto.randomUUID(),challenge_id:challenge.id,status:config.emailMode==='live'?'queued':'blocked',attempts:0,next_attempt_at:now,lease_id:null,lease_until:null,last_error_code:null,provider_message_id:null,created_at:now,sent_at:null};
  return {challenge,outbox};
}
export async function assertEmailRateLimit(db,accountId,now){const latest=await db.prepare('SELECT created_at FROM real_email_challenges WHERE account_id=? ORDER BY created_at DESC LIMIT 1').bind(accountId).first();if(latest&&now-latest.created_at<60000)throw new DomainError('Повторное письмо доступно через минуту.',429);const count=await db.prepare('SELECT COUNT(*) AS total FROM real_email_challenges WHERE account_id=? AND created_at>?').bind(accountId,now-3600000).first();if(count.total>=5)throw new DomainError('Не больше пяти запросов письма в час.',429);}
export function emailRecordStatements(repository,records,operation){return [repository.guardedInsert('real_email_challenges',records.challenge,['id'],operation),repository.guardedInsert('real_email_outbox',records.outbox,['id'],operation)];}
export async function requestVerification(repository,snapshot,account,config,now=Date.now()){
  if(account.email_verified_at!==null)return {emailStatus:'verified'};
  await assertEmailRateLimit(repository.db,account.id,now);const records=await buildEmailChallenge(account,config,now);
  await repository.transaction(snapshot.revision,operation=>emailRecordStatements(repository,records,operation));
  return {emailStatus:records.outbox.status,challengeId:records.challenge.id,expiresAt:records.challenge.expires_at};
}
export async function verifyAccountEmail(repository,snapshot,account,input,now=Date.now()){
  const challenge=await repository.db.prepare('SELECT * FROM real_email_challenges WHERE id=? AND account_id=?').bind(String(input.challengeId||''),account.id).first();
  if(!challenge||challenge.recipient!==account.email||challenge.consumed_at!==null||challenge.expires_at<=now||challenge.failed_attempts>=5||challenge.delivery_state!=='sent')throw new DomainError('Ссылка подтверждения недоступна или истекла.',400);
  const supplied=await tokenHash(String(input.token||'').slice(0,128));
  if(!equalHash(challenge.token_hash,supplied)){
    await repository.transaction(snapshot.revision,operation=>[repository.db.prepare("UPDATE real_email_challenges SET failed_attempts=MIN(5,failed_attempts+1) WHERE id=? AND consumed_at IS NULL AND EXISTS(SELECT 1 FROM real_revisions WHERE id='main' AND op_id=?)").bind(challenge.id,operation)]);
    return {verificationError:'Неверная ссылка подтверждения.'};
  }
  await repository.transaction(snapshot.revision,operation=>[
    repository.db.prepare("UPDATE real_email_challenges SET consumed_at=? WHERE id=? AND account_id=? AND consumed_at IS NULL AND expires_at>? AND failed_attempts<5 AND delivery_state='sent' AND EXISTS(SELECT 1 FROM real_revisions WHERE id='main' AND op_id=?)").bind(now,challenge.id,account.id,now,operation),
    repository.db.prepare("UPDATE real_accounts SET email_verified_at=? WHERE id=? AND email=? AND EXISTS(SELECT 1 FROM real_email_challenges WHERE id=? AND consumed_at=?) AND EXISTS(SELECT 1 FROM real_revisions WHERE id='main' AND op_id=?)").bind(now,account.id,challenge.recipient,challenge.id,now,operation),
  ]);
  return {emailStatus:'verified'};
}
export function assertEmailDeliveryConfiguration(config){
  if(config.emailMode!=='live')return false;
  if([config.resendApiKey,config.sender,config.siteOrigin].some(value=>typeof value!=='string'||!value.trim())||typeof config.tokenSecret!=='string'||config.tokenSecret.length<32||!config.tokenSecret.trim())throw new DomainError('Отправка email не настроена полностью.',503);
  let origin;
  try{origin=new URL(config.siteOrigin);}catch{throw new DomainError('Некорректный адрес сервиса.',503);}
  if(origin.protocol!=='https:'||origin.pathname!=='/'||origin.search||origin.hash||origin.username||origin.password)throw new DomainError('Некорректный адрес сервиса.',503);
  return true;
}
// No timer, cron, or public endpoint activates this worker. The operator must
// configure and authorize an invocation separately after live delivery is approved.
export async function drainEmailOutbox(db,config,{now=Date.now(),limit=5,fetcher=fetch}={}){
  if(!assertEmailDeliveryConfiguration(config))return {enabled:false,processed:0,sent:0};
  const summary={enabled:true,processed:0,sent:0};
  for(let index=0;index<Math.min(10,Math.max(0,limit));index++){
    const job=await db.prepare("SELECT o.*,c.account_id,c.recipient,c.token_hash,c.expires_at,c.consumed_at FROM real_email_outbox o JOIN real_email_challenges c ON c.id=o.challenge_id WHERE ((o.status IN ('queued','retry') AND o.next_attempt_at<=?) OR (o.status='leased' AND o.lease_until<=?)) ORDER BY o.created_at LIMIT 1").bind(now,now).first();
    if(!job)break;
    const lease=crypto.randomUUID();const claim=await db.prepare("UPDATE real_email_outbox SET status='leased',lease_id=?,lease_until=?,attempts=attempts+1 WHERE id=? AND ((status IN ('queued','retry') AND next_attempt_at<=?) OR (status='leased' AND lease_until<=?))").bind(lease,now+60000,job.id,now,now).run();
    if(claim.meta.changes!==1)continue;summary.processed++;
    if(job.expires_at<=now||job.consumed_at!==null){await db.prepare("UPDATE real_email_outbox SET status='cancelled',lease_until=NULL,last_error_code='CHALLENGE_UNAVAILABLE' WHERE id=? AND lease_id=? AND status='leased'").bind(job.id,lease).run();continue;}
    const token=await challengeToken(config.tokenSecret,{id:job.challenge_id,account_id:job.account_id,recipient:job.recipient,expires_at:job.expires_at});
    if(!equalHash(await tokenHash(token),job.token_hash)){await db.prepare("UPDATE real_email_outbox SET status='failed',lease_until=NULL,last_error_code='TOKEN_KEY_CHANGED' WHERE id=? AND lease_id=? AND status='leased'").bind(job.id,lease).run();continue;}
    const link=`${config.siteOrigin.replace(/\/$/,'')}/account/verify#challenge=${encodeURIComponent(job.challenge_id)}&token=${token}`;
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),10000);
    let accepted=false,providerId=null,errorCode='NETWORK_ERROR',retryable=true;
    try{
      const response=await fetcher('https://api.resend.com/emails',{method:'POST',signal:controller.signal,headers:{Authorization:`Bearer ${config.resendApiKey}`,'Content-Type':'application/json','Idempotency-Key':`fsp-verify-${job.challenge_id}`},body:JSON.stringify({from:config.sender,to:[job.recipient],subject:'Подтверждение email · ФСП / ТАЛАНТЫ',text:`Вы запросили подтверждение адреса для своего аккаунта. Откройте ссылку: ${link}\nСсылка действует 15 минут и используется один раз. Если запрос не ваш, проигнорируйте письмо.`})});
      if(response.ok){
        // A malformed success may follow provider acceptance. Retry the same
        // payload and idempotency key; never record delivery without an ID.
        errorCode='INVALID_PROVIDER_RESPONSE';
        const body=await response.json();
        if(typeof body?.id==='string'&&body.id.trim()){providerId=body.id;accepted=true;}
      }else{errorCode=`HTTP_${response.status}`;retryable=response.status>=500||[408,409,425,429].includes(response.status);}
    }catch{/* Do not log email addresses, payloads, tokens, or credentials. */}finally{clearTimeout(timeout);}
    if(accepted){
      const results=await db.batch([
        db.prepare("UPDATE real_email_outbox SET status='sent',provider_message_id=?,sent_at=?,lease_until=NULL,last_error_code=NULL WHERE id=? AND lease_id=? AND status='leased'").bind(providerId,now,job.id,lease),
        db.prepare("UPDATE real_email_challenges SET delivery_state='sent' WHERE id=? AND EXISTS(SELECT 1 FROM real_email_outbox WHERE id=? AND lease_id=? AND status='sent')").bind(job.challenge_id,job.id,lease),
        db.prepare("UPDATE real_email_challenges SET consumed_at=?,delivery_state='superseded' WHERE account_id=? AND id<>? AND created_at<=? AND consumed_at IS NULL AND EXISTS(SELECT 1 FROM real_email_outbox WHERE id=? AND lease_id=? AND status='sent')").bind(now,job.account_id,job.challenge_id,job.created_at,job.id,lease),
      ]);if(results[0].meta.changes===1)summary.sent++;
    }else{
      const attempts=job.attempts+1,status=retryable&&attempts<5?'retry':'failed';
      await db.prepare("UPDATE real_email_outbox SET status=?,next_attempt_at=?,lease_until=NULL,last_error_code=? WHERE id=? AND lease_id=? AND status='leased'").bind(status,now+Math.min(300000,60000*2**(attempts-1)),errorCode,job.id,lease).run();
    }
  }
  return summary;
}
