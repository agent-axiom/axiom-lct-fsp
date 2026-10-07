import {assessmentDraftIdentity} from './assessment-draft-identity.mjs';
import {RealAccountsService} from './real-accounts.mjs';
import {DomainError} from './domain.mjs';
import {readJsonBody} from './http-body.mjs';
export const accountHeaders={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
// principal is supplied exclusively by the trusted platform adapter, never by
// JSON, cookies, query parameters or arbitrary forwarded client headers.
/**
 * @param {Request} request
 * @param {{principal: {issuer:string,subject:string}|null, db:unknown, config:ReturnType<import('./real-accounts.mjs').realAccountsConfiguration>, renderProfile?: (user:import('./types').User)=>Promise<Uint8Array>}} options
 */
export async function handleAccountRequest(request,{principal,db,config,renderProfile}){
  try{
    const url=new URL(request.url),service=new RealAccountsService(db,config);
    if(request.method==='GET'&&url.pathname==='/api/account/state'&&!config.accountsEnabled)return Response.json(await service.state(null),{headers:accountHeaders});
    if(!principal)throw new DomainError('Нужно войти в ChatGPT.',401);
    if(request.method==='GET'&&url.pathname==='/api/account/profile.pdf'){const state=await service.state(principal);if(!state.enabled||!state.enrolled||!state.user?.verified||state.user.role!=='candidate')throw new DomainError('Доступен только собственный подтверждённый профиль.',403);if(!renderProfile)throw new DomainError('PDF временно недоступен.',503);return new Response(await renderProfile(state.user),{headers:{...accountHeaders,'Content-Type':'application/pdf','Content-Disposition':'attachment; filename="fsp-profile.pdf"'}});}
    if(request.method==='GET'&&url.pathname==='/api/account/state')return Response.json({...await service.state(principal),draftIdentity:await assessmentDraftIdentity('account',[principal.issuer,principal.subject])},{headers:accountHeaders});
    if(request.method==='POST'&&url.pathname==='/api/account/action'){
      if(request.headers.get('origin')!==url.origin)throw new DomainError('Источник запроса не разрешён.',403);
      const input=await readJsonBody(request);const result=await service.execute(principal,input);
      return Response.json(result,{headers:accountHeaders});
    }
    throw new DomainError('Не найдено.',404);
  }catch(error){return Response.json({error:error instanceof DomainError?error.message:'Хранилище временно недоступно. Повторите действие.'},{status:error instanceof DomainError?error.status:503,headers:accountHeaders});}
}
