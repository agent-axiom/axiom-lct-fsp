import {DomainError} from './domain.mjs';
import {readJsonBody} from './http-body.mjs';
import {assessmentDraftIdentity} from './assessment-draft-identity.mjs';
import {RealAccountsService} from './real-accounts.mjs';
import {PublicEmailAuth,assertPublicEmailConfiguration} from './public-email-auth.mjs';
export const publicAccountHeaders={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Vary':'Cookie'};
const actions=new Set(['profile','company','test-start','test-submit','search','invite','invitation-status']);
/** Public email authentication is separate from the trusted Sites principal adapter.
 * @param {Request} request
 * @param {{db:unknown,config:ReturnType<import('./public-email-auth.mjs').publicEmailAuthConfiguration>,clock?:()=>number,emailFetcher?:typeof fetch,renderProfile?:(user:import('./types').User)=>Promise<Uint8Array>}} options
 */
export async function handlePublicAccountRequest(request,{db,config,clock=Date.now,emailFetcher=fetch,renderProfile}){
 try{
  const url=new URL(request.url),path=url.pathname;
  const routes=new Set(['/api/public-account/state','/api/public-account/action','/api/public-account/profile.pdf','/api/public-account/auth/request','/api/public-account/auth/consume','/api/public-account/auth/logout']);
  if(!routes.has(path)||!['GET','POST'].includes(request.method)||(request.method==='GET'&&!['/api/public-account/state','/api/public-account/profile.pdf'].includes(path))||(request.method==='POST'&&['/api/public-account/state','/api/public-account/profile.pdf'].includes(path)))throw new DomainError('Страница не найдена.',404);
  if([...url.searchParams.keys()].some(key=>['token','session','principal','owner','account'].includes(key)))throw new DomainError('Ключи входа не передаются через адрес страницы.');
  if(request.method==='POST'){
   if(request.headers.get('origin')!==url.origin||request.headers.get('sec-fetch-site')==='cross-site')throw new DomainError('Источник запроса не разрешён.',403);
   if((request.headers.get('content-type')||'').split(';')[0].trim().toLowerCase()!=='application/json')throw new DomainError('Нужен JSON-запрос.',415);
  }
  const common={enabled:!!config.accountsEnabled&&!!config.emailAuthEnabled,emailEnabled:config.emailMode==='live',enrolled:false,authMode:'email',user:null,privacyNoticeUrl:config.privacyNoticeUrl,privacyNoticeVersion:config.privacyNoticeVersion};
  if(path==='/api/public-account/state'&&!common.enabled)return Response.json({...common,message:'Вход по email пока не включён. Демонстрация доступна без регистрации.'},{headers:publicAccountHeaders});
  if(path!=='/api/public-account/auth/logout')assertPublicEmailConfiguration(config);
  const auth=new PublicEmailAuth(db,config),now=clock();
  if(path.startsWith('/api/public-account/auth/')){
   const input=await readJsonBody(request);if(!input||typeof input!=='object'||Array.isArray(input))throw new DomainError('Некорректный запрос.');
   const result=path.endsWith('/request')?await auth.request(input,request,{now,emailFetcher}):path.endsWith('/consume')?await auth.consume(input,request,now):await auth.logout(request,now);
   const headers=new Headers(publicAccountHeaders);for(const cookie of result.cookies)headers.append('Set-Cookie',cookie);
   return Response.json(result.body,{headers});
  }
  const session=await auth.session(request,now);
  if(!session){if(path==='/api/public-account/state')return Response.json(common,{headers:publicAccountHeaders});throw new DomainError('Войдите по ссылке из email.',401);}
  const service=new RealAccountsService(db,config,{authChannel:'public-email'});
  if(path==='/api/public-account/state')return Response.json({...await service.state(session.principal,now),authMode:'email',draftIdentity:await assessmentDraftIdentity('public-account',session.accountId)},{headers:publicAccountHeaders});
  if(path==='/api/public-account/profile.pdf'){
   const state=await service.state(session.principal,now);if(!state.user?.verified||state.user.role!=='candidate')throw new DomainError('Доступен только собственный подтверждённый профиль.',403);if(!renderProfile)throw new DomainError('PDF временно недоступен.',503);
   return new Response(await renderProfile(state.user),{headers:{...publicAccountHeaders,'Content-Type':'application/pdf','Content-Disposition':'attachment; filename="fsp-profile.pdf"'}});
  }
  const input=await readJsonBody(request);if(!input||typeof input!=='object'||Array.isArray(input)||!actions.has(input.action))throw new DomainError('Действие недоступно в публичном кабинете.',403);
  return Response.json(await service.execute(session.principal,input,now),{headers:publicAccountHeaders});
 }catch(error){return Response.json({error:error instanceof DomainError?error.message:'Вход временно недоступен. Повторите действие позже.'},{status:error instanceof DomainError?error.status:503,headers:publicAccountHeaders});}
}
