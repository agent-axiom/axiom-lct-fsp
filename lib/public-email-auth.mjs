import {DomainError} from './domain.mjs';
import {realAccountsConfiguration} from './real-accounts.mjs';
import {assertEmailDeliveryConfiguration,tokenHash,equalHash} from './email-outbox.mjs';
import {sendVerification} from './email-transport.mjs';

export const ACCOUNT_COOKIE='__Host-fsp_account';
export const AUTH_COOKIE='__Host-fsp_auth';
export const AUTH_TTL=15*60000;
export const SESSION_TTL=24*60*60000;
const randomToken=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),byte=>byte.toString(16).padStart(2,'0')).join('');
const clean=(value,max)=>typeof value==='string'?value.trim().slice(0,max):'';
export function publicEmailAuthConfiguration(env={}){return {...realAccountsConfiguration(env),emailAuthEnabled:env.FSP_EMAIL_AUTH_ENABLED==='true',publicPilotEmails:env.FSP_PUBLIC_ACCOUNT_PILOT_EMAILS};}
export const authCookie=(name,value,maxAge)=>`${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
export function cookieToken(request,name){const entries=(request.headers.get('cookie')||'').split(';').map(value=>value.trim()).filter(value=>value.startsWith(name+'='));if(entries.length!==1)return null;const value=entries[0].slice(name.length+1);return /^[a-f0-9]{64}$/.test(value)?value:null;}
export function assertPublicEmailConfiguration(config){
 if(!config.accountsEnabled||!config.emailAuthEnabled)throw new DomainError('Вход по email пока не включён. Можно открыть демонстрацию.',503);
 let policy;try{policy=new URL(config.privacyNoticeUrl);}catch{throw new DomainError('Политика обработки данных пока не настроена.',503);}
 if(policy.protocol!=='https:'||!policy.hostname||policy.username||policy.password||typeof config.privacyNoticeVersion!=='string'||!config.privacyNoticeVersion.trim())throw new DomainError('Политика обработки данных пока не настроена.',503);
 publicEmailPilot(config);
}
function publicEmailPilot(config){
 if(config.publicPilotEmails===undefined)return null;
 let emails;try{emails=JSON.parse(config.publicPilotEmails);}catch{throw new DomainError('Доступ к email-пилоту ещё не настроен.',503);}
 if(!Array.isArray(emails)||!emails.length||emails.length>100||emails.some(email=>typeof email!=='string'||email!==email.trim()||email.length>254||!/^\S+@\S+\.\S+$/.test(email)))throw new DomainError('Доступ к email-пилоту ещё не настроен.',503);
 return new Set(emails.map(email=>email.toLowerCase()));
}
export function assertPublicEmailAccess(config,email){const allowed=publicEmailPilot(config);if(allowed&&!allowed.has(email))throw new DomainError('Этот email не участвует в закрытом пилоте.',403);}

export class PublicEmailAuth {
 constructor(db,config){this.db=db;this.config=config;}
 async cleanup(now){await this.db.batch([this.db.prepare('DELETE FROM public_email_auth_requests WHERE expires_at<=?').bind(now-3600000),this.db.prepare('DELETE FROM public_account_sessions WHERE expires_at<=?').bind(now),this.db.prepare('DELETE FROM public_email_auth_limits WHERE window_started_at<=?').bind(now-2*3600000)]);}
 async request(input,request,{now=Date.now(),emailFetcher=fetch}={}){
  assertPublicEmailConfiguration(this.config);
  if(this.config.emailMode!=='live'||(this.config.emailTransport||'resend')!=='resend')throw new DomainError('Отправка ссылок входа пока не настроена.',503);
  assertEmailDeliveryConfiguration(this.config);
  const email=clean(input.email,255).toLowerCase();if(email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new DomainError('Введите корректный email.');
  assertPublicEmailAccess(this.config,email);
  if(!['login','register'].includes(input.mode))throw new DomainError('Выберите вход или регистрацию.');
  const registration=input.mode==='register',name=clean(input.name,80),role=input.role;
  if(registration&&(!['candidate','employer'].includes(role)||name.length<2))throw new DomainError('Укажите роль и имя или название компании.');
  if(registration&&(input.dataConsent!==true||input.privacyNoticeVersion!==this.config.privacyNoticeVersion))throw new DomainError('Подтвердите актуальную политику обработки данных.');
  await this.cleanup(now);
  const id=crypto.randomUUID(),token=randomToken(),browser=cookieToken(request,AUTH_COOKIE)||randomToken(),browserHash=await tokenHash(browser),hash=await tokenHash(token),operation=crypto.randomUUID(),emailKey=await tokenHash(email);
  const buckets=[{id:'request-global',interval:60000,limit:30},{id:`email-minute:${emailKey}`,interval:60000,limit:1},{id:`email-hour:${emailKey}`,interval:3600000,limit:5}];
  const results=await this.db.batch([
   ...buckets.map(bucket=>this.db.prepare('INSERT INTO public_email_auth_limits(id,window_started_at,request_count,operation_id) VALUES(?,?,1,?) ON CONFLICT(id) DO UPDATE SET window_started_at=CASE WHEN window_started_at<=? THEN excluded.window_started_at ELSE window_started_at END,request_count=CASE WHEN window_started_at<=? THEN 1 ELSE request_count+1 END,operation_id=excluded.operation_id WHERE window_started_at<=? OR request_count<?').bind(bucket.id,now,operation,now-bucket.interval,now-bucket.interval,now-bucket.interval,bucket.limit)),
   this.db.prepare("INSERT INTO public_email_auth_requests(id,email,mode,role,name,privacy_notice_version,privacy_accepted_at,token_hash,browser_hash,created_at,expires_at,delivery_state) SELECT ?,?,?,?,?,?,?,?,?,?,?,'sending' WHERE (SELECT COUNT(*) FROM public_email_auth_limits WHERE id IN (?,?,?) AND operation_id=?)=3 AND (SELECT COUNT(*) FROM public_email_auth_requests WHERE expires_at>? AND consumed_at IS NULL)<128").bind(id,email,input.mode,registration?role:null,registration?name:null,registration?this.config.privacyNoticeVersion:null,registration?now:null,hash,browserHash,now,now+AUTH_TTL,...buckets.map(bucket=>bucket.id),operation,now),
  ]);
  if(results[3].meta.changes!==1)throw new DomainError('Слишком много запросов. Новую ссылку можно запросить через минуту; максимум пять писем в час на email.',429);
  const link=`${this.config.siteOrigin.replace(/\/$/,'')}/account/verify#challenge=${encodeURIComponent(id)}&token=${token}`;
  const payload=JSON.stringify({from:this.config.sender,to:[email],subject:'Ссылка входа · ФСП / ТАЛАНТЫ',text:`Вы запросили ${registration?'регистрацию':'вход'} в ФСП / ТАЛАНТЫ. Откройте ссылку в том же браузере, в котором сделали запрос: ${link}\nСсылка действует 15 минут и используется один раз. Если запрос не ваш, проигнорируйте письмо.`});
  const sent=await sendVerification(this.config,{challenge_id:id},payload,emailFetcher,now);
  const delivery=sent.accepted?'accepted':sent.errorCode==='DELIVERY_UNKNOWN'||sent.errorCode==='NETWORK_ERROR'||sent.errorCode==='INVALID_PROVIDER_RESPONSE'?'unknown':'rejected';
  await this.db.prepare('UPDATE public_email_auth_requests SET delivery_state=?,provider_message_id=?,error_code=? WHERE id=? AND delivery_state=?').bind(delivery,sent.accepted?sent.providerId:null,sent.accepted?null:sent.errorCode,id,'sending').run();
  return {body:{requested:true,message:'Если адрес указан верно, письмо со ссылкой придёт на него. Откройте ссылку в этом браузере. Новую ссылку можно запросить через минуту.'},cookies:[authCookie(AUTH_COOKIE,browser,AUTH_TTL/1000)]};
 }
 async consume(input,request,now=Date.now()){
  assertPublicEmailConfiguration(this.config);
  const browser=cookieToken(request,AUTH_COOKIE);if(!browser)throw new DomainError('Откройте ссылку в браузере, в котором запросили письмо, или запросите новую ссылку.');
  const id=clean(input.challengeId,100),token=clean(input.token,129);
  if(!id||!/^[a-f0-9]{64}$/.test(token))throw new DomainError('Ссылка входа недействительна. Запросите новую.');
  const challenge=await this.db.prepare('SELECT * FROM public_email_auth_requests WHERE id=?').bind(id).first();
  const browserHash=await tokenHash(browser);
  if(!challenge||challenge.expires_at<=now||challenge.consumed_at!==null||challenge.failed_attempts>=5||!equalHash(challenge.browser_hash,browserHash))throw new DomainError('Ссылка недействительна, уже использована или открыта в другом браузере. Запросите новую.');
  assertPublicEmailAccess(this.config,challenge.email);
  const hash=await tokenHash(token);
  if(!equalHash(challenge.token_hash,hash)){await this.db.prepare('UPDATE public_email_auth_requests SET failed_attempts=MIN(5,failed_attempts+1) WHERE id=? AND consumed_at IS NULL').bind(id).run();throw new DomainError('Неверная ссылка входа. Запросите новую.');}
  const existing=await this.db.prepare('SELECT * FROM real_accounts WHERE email=?').bind(challenge.email).first();
  if(existing&&existing.issuer!=='fsp-email')throw new DomainError('Этот адрес уже связан с другим способом входа. Автоматическое объединение аккаунтов не выполняется.');
  if(!existing&&challenge.mode!=='register')throw new DomainError('Для этого email ещё нет профиля. Выберите регистрацию и запросите новую ссылку.');
  if(!existing&&(challenge.privacy_notice_version!==this.config.privacyNoticeVersion||!challenge.privacy_accepted_at))throw new DomainError('Политика обновилась. Повторите регистрацию с актуальным согласием.');
  await this.db.prepare("INSERT OR IGNORE INTO real_revisions(id,revision,op_id) VALUES('main',0,'')").run();
  const revision=await this.db.prepare("SELECT revision FROM real_revisions WHERE id='main'").first();
  const accountId=existing?.id||crypto.randomUUID(),sessionToken=randomToken(),sessionHash=await tokenHash(sessionToken),operation=crypto.randomUUID();
  const claimed="EXISTS(SELECT 1 FROM public_email_auth_requests WHERE id=? AND consume_operation=?)";
  const statements=[
   this.db.prepare("UPDATE real_revisions SET revision=revision+1,op_id=? WHERE id='main' AND revision=?").bind(operation,revision.revision),
   this.db.prepare("UPDATE public_email_auth_requests SET consumed_at=?,consume_operation=? WHERE id=? AND consumed_at IS NULL AND expires_at>? AND failed_attempts<5 AND token_hash=? AND browser_hash=? AND EXISTS(SELECT 1 FROM real_revisions WHERE id='main' AND op_id=?)").bind(now,operation,id,now,hash,browserHash,operation),
  ];
  if(!existing){
   statements.push(this.db.prepare(`INSERT INTO real_accounts(id,issuer,subject,role,email,name,privacy_accepted_at,privacy_notice_version,email_verified_at,created_at) SELECT ?,'fsp-email',?,?,?,?,?,?,?,? WHERE ${claimed}`).bind(accountId,accountId,challenge.role,challenge.email,challenge.name,challenge.privacy_accepted_at,challenge.privacy_notice_version,now,now,id,operation));
   statements.push(challenge.role==='candidate'?this.db.prepare(`INSERT INTO real_candidate_profiles(account_id) SELECT ? WHERE ${claimed}`).bind(accountId,id,operation):this.db.prepare(`INSERT INTO real_employer_profiles(account_id,company,description) SELECT ?,?,'' WHERE ${claimed}`).bind(accountId,challenge.name,id,operation));
  }
  statements.push(this.db.prepare(`INSERT INTO public_account_sessions(token_hash,account_id,created_at,expires_at) SELECT ?,?,?,? WHERE ${claimed}`).bind(sessionHash,accountId,now,now+SESSION_TTL,id,operation));
  let results;try{results=await this.db.batch(statements);}catch{throw new DomainError('Аккаунт изменился. Повторите подтверждение ссылки.',409);}
  if(results[0].meta.changes!==1||results[1].meta.changes!==1||results.at(-1).meta.changes!==1)throw new DomainError('Ссылка уже использована или данные изменились. Запросите новую ссылку.',409);
  return {body:{ok:true,enrolled:true,authMode:'email'},cookies:[authCookie(ACCOUNT_COOKIE,sessionToken,SESSION_TTL/1000),authCookie(AUTH_COOKIE,'',0)]};
 }
 async session(request,now=Date.now()){
  assertPublicEmailConfiguration(this.config);
  const token=cookieToken(request,ACCOUNT_COOKIE);if(!token)return null;
  const row=await this.db.prepare("SELECT a.id,a.issuer,a.subject,a.email FROM public_account_sessions s JOIN real_accounts a ON a.id=s.account_id WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>? AND a.issuer='fsp-email' AND a.email_verified_at IS NOT NULL").bind(await tokenHash(token),now).first();
  if(!row)return null;assertPublicEmailAccess(this.config,row.email);
  return {accountId:row.id,principal:{issuer:row.issuer,subject:row.subject}};
 }
 async logout(request,now=Date.now()){
  const token=cookieToken(request,ACCOUNT_COOKIE);
  if(token)await this.db.prepare('UPDATE public_account_sessions SET revoked_at=? WHERE token_hash=? AND revoked_at IS NULL').bind(now,await tokenHash(token)).run();
  return {body:{ok:true},cookies:[authCookie(ACCOUNT_COOKIE,'',0),authCookie(AUTH_COOKIE,'',0)]};
 }
}
