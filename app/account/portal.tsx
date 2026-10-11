'use client';
import {useCallback,useEffect,useRef,useState,type FormEvent} from 'react';
import Link from 'next/link';
import {clearAssessmentDraft} from '@/lib/assessment-drafts.mjs';
import Workspace from '@/app/workspace';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import type {AccountState} from '@/lib/types';

type EmailLink={challengeId:string;token:string};
type AuthResult={requested?:boolean;message?:string;error?:string;enrolled?:boolean;ok?:boolean};
const api='/api/public-account';

export default function AccountPortal({verification=false,canonicalOrigin=''}:{verification?:boolean;canonicalOrigin?:string}){
 const [state,setState]=useState<AccountState|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
 const [mode,setMode]=useState<'login'|'register'>('login'),[name,setName]=useState(''),[email,setEmail]=useState(''),[role,setRole]=useState('candidate'),[consent,setConsent]=useState(false);
 const [link,setLink]=useState<EmailLink|null>(null),[linkRead,setLinkRead]=useState(!verification),[requested,setRequested]=useState(false),[retryAt,setRetryAt]=useState(0),[displayNow,setDisplayNow]=useState(()=>Date.now());
 const lock=useRef(false),fragmentRead=useRef(false);
 const [verifiedLink,setVerifiedLink]=useState(false);
 const refresh=useCallback(async()=>{
  const response=await fetch(`${api}/state`,{credentials:'same-origin',cache:'no-store'});
  const value=await response.json() as AccountState;
  if(!response.ok)throw new Error(value.error||'Не удалось проверить состояние кабинета.');
  setState(value);
 },[]);
 useEffect(()=>{if(canonicalOrigin&&window.location.origin!==canonicalOrigin){window.location.replace(canonicalOrigin+(verification?'/account/verify':'/account')+window.location.hash);return;}Promise.resolve().then(refresh).catch(error=>setError(error instanceof Error?error.message:'Не удалось проверить состояние кабинета.'));},[refresh,canonicalOrigin,verification]);
 useEffect(()=>{
  if(!verification||fragmentRead.current||(canonicalOrigin&&window.location.origin!==canonicalOrigin))return;
  fragmentRead.current=true;
  const params=new URLSearchParams(window.location.hash.slice(1)),challengeId=params.get('challenge'),token=params.get('token');
  // The secret stays only in this page's memory, never in storage or API query strings.
  if(window.location.hash)window.history.replaceState(null,'',window.location.pathname+window.location.search);
  queueMicrotask(()=>{
   if(challengeId&&token&&challengeId.length<=100&&/^[a-f0-9]{64}$/.test(token))setLink({challengeId,token});
   setLinkRead(true);
  });
 },[verification,canonicalOrigin]);
 useEffect(()=>{
  if(retryAt<=Date.now())return;
  const timer=setInterval(()=>{const now=Date.now();setDisplayNow(now);if(now>=retryAt)clearInterval(timer);},1000);
  return ()=>clearInterval(timer);
 },[retryAt]);
 async function send(path:string,input:unknown){
  if(lock.current)return;
  lock.current=true;setBusy(true);setError('');setNotice('');
  try{
   const response=await fetch(`${api}/auth/${path}`,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
   const value=await response.json() as AuthResult;
   if(!response.ok)throw new Error(value.error||'Не удалось выполнить действие.');
   if(path==='request'){
    setRequested(true);setRetryAt(Date.now()+60000);setDisplayNow(Date.now());
    setNotice(value.message||'Если адрес указан верно, письмо со ссылкой придёт на него. Откройте ссылку в этом браузере.');
   }else if(path==='consume'){
    setLink(null);setState(null);setVerifiedLink(true);clearAssessmentDraft();setNotice('Вход подтверждён. Открываем кабинет…');
    try{await refresh();}catch{setError('Вход подтверждён, но состояние кабинета пока не загрузилось. Повторите проверку или откройте кабинет по ссылке ниже.');}
   }
  }catch(error){setError(error instanceof Error?error.message:'Не удалось выполнить действие.');}
  finally{lock.current=false;setBusy(false);}
 }
 async function requestEmail(event:FormEvent){
  event.preventDefault();
  await send('request',{mode,email,...(mode==='register'?{name,role,dataConsent:consent,privacyNoticeVersion:state?.privacyNoticeVersion}:{})});
 }
 async function refreshStatus(){
  if(lock.current)return;
  lock.current=true;setBusy(true);setError('');
  try{await refresh();}catch(error){setError(error instanceof Error?error.message:'Не удалось проверить состояние кабинета.');}
  finally{lock.current=false;setBusy(false);}
 }
 const cooldown=retryAt>displayNow;
 const registrationReady=mode==='login'||!!state?.privacyNoticeUrl&&!!state.privacyNoticeVersion&&consent;
 if((!verification||verifiedLink)&&state?.enrolled&&state.user?.verified)return <Workspace real emailAuth/>;
 return <main className="account-landing">
  <Link className="eyebrow" href="/">ФСП / ТАЛАНТЫ</Link>
  <h1>{verification?'Подтверждение входа':'Личный кабинет'}</h1>
  {error&&<div className="alert" role="alert">{error}</div>}
  {notice&&<div className="success" role="status">{notice}</div>}
  {verification&&verifiedLink?<section className="panel form-grid"><p>Вход подтверждён. Проверяем состояние вашего кабинета.</p><Button variant="outline" disabled={busy} onClick={refreshStatus}>Повторить проверку</Button><Link className="account-link" href="/account">Открыть кабинет →</Link></section>:!state?<><p>Проверяем состояние кабинета…</p>{error&&<Button variant="outline" disabled={busy} onClick={refreshStatus}>Повторить проверку</Button>}</>:!state.enabled?<>
   <p>{state.message||'Вход по email пока не включён. Демонстрация доступна без регистрации.'}</p>
   <Link className="account-link" href="/">Открыть демонстрацию →</Link>
  </>:verification?<section className="panel form-grid">
   <p>Ссылка действует 15 минут и используется один раз. Откройте её в том же браузере, в котором запросили письмо.</p>
   {!linkRead?<p>Проверяем ссылку…</p>:link?<>
    <p>Нажмите кнопку, чтобы подтвердить вход. Открытие страницы само по себе не создаёт аккаунт и не выполняет вход.</p>
    <Button disabled={busy} onClick={()=>send('consume',link)}>Подтвердить вход по email</Button>
   </>:<p>В этой странице нет действующей ссылки. Если вы обновили страницу, откройте оригинальную ссылку из письма повторно. Если ссылка истекла или уже использована, запросите новую.</p>}
   <p className="micro">Секретная часть ссылки удалена из адресной строки и не сохраняется в браузере.</p>
   <Link className="account-link" href="/account">Запросить новую ссылку →</Link>
  </section>:!state.emailEnabled?<>
   <p>Отправка ссылок входа пока не включена. Реальная регистрация недоступна.</p>
   <Link className="account-link" href="/">Открыть демонстрацию →</Link>
  </>:<form className="panel form-grid" onSubmit={requestEmail}>
   <div className="actions"><Button type="button" variant={mode==='login'?'default':'outline'} disabled={busy} aria-pressed={mode==='login'} onClick={()=>{setMode('login');setError('');setNotice('');setRequested(false);}}>Войти</Button><Button type="button" variant={mode==='register'?'default':'outline'} disabled={busy} aria-pressed={mode==='register'} onClick={()=>{setMode('register');setError('');setNotice('');setRequested(false);}}>Зарегистрироваться</Button></div>
   <p>Вход по одноразовой ссылке из письма. Пароль и аккаунт ChatGPT не нужны.</p>
   {mode==='register'&&<>
    <label className="field"><span>Роль аккаунта</span><select value={role} disabled={busy} onChange={event=>setRole(event.target.value)}><option value="candidate">Кандидат</option><option value="employer">Работодатель</option></select></label>
    <p className="micro">Роль закрепится за вашим email. Один адрес соответствует одному личному кабинету.</p>
    <label className="field"><span>{role==='candidate'?'Имя':'Название компании'}</span><Input required minLength={2} maxLength={80} autoComplete="name" disabled={busy} value={name} onChange={event=>setName(event.target.value)}/></label>
   </>}
   <label className="field"><span>Email для входа и контакта</span><Input required type="email" maxLength={254} autoComplete="email" disabled={busy} value={email} onChange={event=>setEmail(event.target.value)}/></label>
   {mode==='register'&&(state.privacyNoticeUrl&&state.privacyNoticeVersion?<label className="toggle"><input type="checkbox" required disabled={busy} checked={consent} onChange={event=>setConsent(event.target.checked)}/><span>Согласен с <a href={state.privacyNoticeUrl} target="_blank" rel="noreferrer">политикой обработки данных</a> и получением проверочного письма на этот адрес.</span></label>:<p>Регистрация пока недоступна: политика обработки данных готовится.</p>)}
   <Button disabled={busy||cooldown||!registrationReady}>{requested?'Запросить новую ссылку':'Получить ссылку по email'}</Button>
   {cooldown&&<p className="micro" role="status">Новую ссылку можно запросить через {Math.ceil((retryAt-displayNow)/1000)} с.</p>}
   <p className="muted">Ссылка действует 15 минут. Открывайте её в этом браузере. Проверьте также папку «Спам». Ответ на запрос письма не подтверждает его доставку.</p>
  </form>}
  <p className="micro">Учебные оценки навыков требуют экспертной проверки и не являются решением о найме.</p>
  <Link className="account-link" href="/">Открыть демонстрацию без регистрации →</Link>
 </main>;
}
