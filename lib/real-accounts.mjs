import { AccountsRepository } from './accounts-repository.mjs';
import { DomainError, actor, command, view } from './domain.mjs';
import { accountEmailStatus, assertEmailDeliveryConfiguration, buildEmailChallenge, emailRecordStatements, requestVerification, verifyAccountEmail } from './email-outbox.mjs';
const ACTIONS=new Set(['profile','company','test-start','test-submit','search','invite','invitation-status']);
const requireValue=(value,message,status=400)=>{if(!value)throw new DomainError(message,status);};
const text=(value,max)=>typeof value==='string'?value.trim().slice(0,max):'';
export function realAccountsConfiguration(env={}){return {accountsEnabled:env.FSP_REAL_ACCOUNTS_ENABLED==='true',emailMode:env.FSP_EMAIL_MODE==='live'?'live':'off',tokenSecret:env.FSP_EMAIL_TOKEN_SECRET||'',resendApiKey:env.RESEND_API_KEY||'',sender:env.FSP_EMAIL_FROM||'',siteOrigin:env.FSP_SITE_ORIGIN||'',privacyNoticeUrl:env.FSP_PRIVACY_NOTICE_URL||'',privacyNoticeVersion:env.FSP_PRIVACY_NOTICE_VERSION||''};}
export class RealAccountsService {
  constructor(db,config){this.repository=new AccountsRepository(db);this.config=config;}
  assertEnabled(){requireValue(this.config.accountsEnabled,'Реальные аккаунты ещё не активированы. Используйте демонстрацию.',503);requireValue(/^https:\/\//.test(this.config.privacyNoticeUrl)&&this.config.privacyNoticeVersion,'Для реального режима сначала должна быть утверждена политика данных.',503);}
  principal(value){requireValue(value?.issuer&&value?.subject,'Нужен доверенный вход ChatGPT.',401);return {issuer:value.issuer,subject:value.subject};}
  async state(principal,now=Date.now()){
    if(!this.config.accountsEnabled)return {enabled:false,emailEnabled:false,message:'Реальные аккаунты и внешняя почта готовятся; публичная демонстрация работает отдельно.'};
    this.assertEnabled();this.principal(principal);const snapshot=await this.repository.snapshot(principal);
    const account=snapshot.rows.real_accounts.find(row=>row.issuer===principal.issuer&&row.subject===principal.subject);
    const common={enabled:true,emailEnabled:this.config.emailMode==='live',privacyNoticeUrl:this.config.privacyNoticeUrl,privacyNoticeVersion:this.config.privacyNoticeVersion};
    if(!account)return {...common,enrolled:false};
    const own=actor(snapshot.state,account.id),data=view(snapshot.state,own);
    return {...common,...data,enrolled:true,demo:false,accounts:[{id:own.id,role:own.role,name:own.name}],outbox:[],...await accountEmailStatus(this.repository.db,account,this.config,now)};
  }
  async enroll(principal,input,now){
    requireValue(['candidate','employer'].includes(input.role),'Выберите роль.');
    const name=text(input.name,80),email=text(input.email,254).toLowerCase();requireValue(name.length>=2,'Введите имя или название компании.');requireValue(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),'Введите корректный email.');
    requireValue(input.dataConsent===true&&input.privacyNoticeVersion===this.config.privacyNoticeVersion,'Подтвердите актуальную политику обработки данных.');
    const snapshot=await this.repository.snapshot(principal);const existing=snapshot.rows.real_accounts.find(row=>row.issuer===principal.issuer&&row.subject===principal.subject);if(existing)return {enrolled:true,accountId:existing.id,role:existing.role,...await accountEmailStatus(this.repository.db,existing,this.config,now)};
    assertEmailDeliveryConfiguration(this.config);
    requireValue(!await this.repository.db.prepare('SELECT id FROM real_accounts WHERE email=?').bind(email).first(),'Этот адрес недоступен для регистрации.',409);
    const account={id:crypto.randomUUID(),issuer:principal.issuer,subject:principal.subject,role:input.role,email,name,email_verified_at:null,created_at:now,privacy_accepted_at:now,privacy_notice_version:this.config.privacyNoticeVersion};
    const mail=this.config.tokenSecret?await buildEmailChallenge(account,this.config,now):null;
    await this.repository.transaction(snapshot.revision,operation=>[
      this.repository.guardedInsert('real_accounts',account,['id'],operation),
      this.repository.guardedInsert(input.role==='candidate'?'real_candidate_profiles':'real_employer_profiles',input.role==='candidate'?{account_id:account.id}:{account_id:account.id,company:name,description:''},['account_id'],operation),
      ...(mail?emailRecordStatements(this.repository,mail,operation):[]),
    ]);
    return {enrolled:true,accountId:account.id,role:account.role,...(mail?await accountEmailStatus(this.repository.db,account,this.config,now,mail.challenge.id):{emailStatus:'not_configured',emailRetryAllowed:false})};
  }
  async execute(principal,input,now=Date.now()){
    this.assertEnabled();principal=this.principal(principal);requireValue(input&&typeof input==='object'&&!Array.isArray(input),'Некорректный запрос.');
    if(input.action==='register')return this.enroll(principal,input,now);
    requireValue(ACTIONS.has(input.action)||['email-request','email-retry','email-verify'].includes(input.action),'Действие недоступно в реальном кабинете.',403);
    const snapshot=await this.repository.snapshot(principal),account=this.repository.accountFor(snapshot,principal);
    if(['email-request','email-retry'].includes(input.action))requireValue(Object.keys(input).every(key=>key==='action'),'Запрос письма не принимает получателя или идентификатор.',400);
    if(input.action==='email-retry')return accountEmailStatus(this.repository.db,account,this.config,now);
    if(input.action==='email-request')return requestVerification(this.repository,snapshot,account,this.config,now);
    if(input.action==='email-verify')return verifyAccountEmail(this.repository,snapshot,account,input,now);
    const state=structuredClone(snapshot.state),own=actor(state,account.id);
    let result;
    if(input.action==='company'){
      requireValue(own.verified,'Сначала подтвердите email.',403);requireValue(own.role==='employer','Нет доступа для этой роли.',403);
      own.company=text(input.company,100);requireValue(own.company.length>=2,'Введите название компании.');own.description=text(input.description,1500);result={ok:true};
    }else{
      // The verified account email is the only contact. Client actor/role/email
      // values never choose a principal or alter another account.
      const safeInput={...input};delete safeInput.contact;
      result=command(state,account.id,safeInput,now);
      if(input.action==='test-submit'&&result.passed)own.currentAssessmentId=input.testId;
    }
    await this.repository.save(snapshot,state);return result;
  }
}
