import {assessmentDraftIdentity} from './assessment-draft-identity.mjs';
import {freshState,actor,command,view,rankCandidates,DomainError} from './domain.mjs';
import {readJsonBody} from './http-body.mjs';
export const GUEST_COOKIE='__Host-fsp_guest';
export const GUEST_ACTOR_COOKIE='__Host-fsp_guest_actor';
export const GUEST_TTL=2*60*60*1000;
export const GUEST_LIMITS={active:128,newPerMinute:32,requestsPerMinute:120,stateBytes:262144};
export const guestHeaders={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Vary':'Cookie'};
const cookie=(name,value,age=GUEST_TTL/1000)=>`${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${age}`;
function cookieValue(request,name){const values=(request.headers.get('cookie')||'').split(';').map(v=>v.trim()).filter(v=>v.startsWith(name+'=')).map(v=>v.slice(name.length+1));return values.length===1?values[0]:null;}
const tokenValue=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
export const guestTokenHash=async token=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))),b=>b.toString(16).padStart(2,'0')).join('');
const encodedState=state=>{const json=JSON.stringify(state);if(new TextEncoder().encode(json).byteLength>GUEST_LIMITS.stateBytes)throw new DomainError('Демо заполнено. Нажмите «Начать сначала» для нового сценария.',413);return json;};
export class GuestDemoRepository {
 constructor(db){this.db=db;}
 async cleanup(now){await this.db.prepare('DELETE FROM guest_workspaces WHERE expires_at<=?').bind(now).run();}
 async read(hash,now){return this.db.prepare('SELECT token_hash,state,revision,created_at,expires_at,window_started_at,request_count FROM guest_workspaces WHERE token_hash=? AND expires_at>?').bind(hash,now).first();}
 async create(now){
  const token=tokenValue(),hash=await guestTokenHash(token),state=freshState();
  const results=await this.db.batch([
   this.db.prepare('DELETE FROM guest_workspaces WHERE expires_at<=?').bind(now),
   this.db.prepare('INSERT INTO guest_workspaces(token_hash,state,revision,created_at,expires_at,window_started_at,request_count) SELECT ?,?,0,?,?,?,1 WHERE (SELECT COUNT(*) FROM guest_workspaces WHERE expires_at>?)<? AND (SELECT COUNT(*) FROM guest_workspaces WHERE created_at>?)<?').bind(hash,encodedState(state),now,now+GUEST_TTL,now,now,GUEST_LIMITS.active,now-60000,GUEST_LIMITS.newPerMinute),
  ]);
  if(results[1].meta.changes!==1)throw new DomainError('Сейчас открыто много гостевых демонстраций. Попробуйте немного позже или войдите в личное пространство.',429);
  return {token,hash,row:await this.read(hash,now),created:true};
 }
 async resolve(request,now,create=false){
  const token=cookieValue(request,GUEST_COOKIE);
  if(token&&/^[a-f0-9]{64}$/.test(token)){
   const hash=await guestTokenHash(token),row=await this.read(hash,now);
   if(row)return {hash,row,created:false};
  }
  if(create)return this.create(now);
  throw new DomainError('Гостевая сессия истекла. Обновите страницу, чтобы открыть новую демонстрацию.',401);
 }
 async budget(hash,now){
  const result=await this.db.prepare('UPDATE guest_workspaces SET request_count=CASE WHEN window_started_at<=? THEN 1 ELSE request_count+1 END,window_started_at=CASE WHEN window_started_at<=? THEN ? ELSE window_started_at END WHERE token_hash=? AND expires_at>? AND (window_started_at<=? OR request_count<?)').bind(now-60000,now-60000,now,hash,now,now-60000,GUEST_LIMITS.requestsPerMinute).run();
  if(result.meta.changes!==1)throw new DomainError('Слишком много действий в гостевом демо. Подождите минуту.',429);
 }
 async mutate(hash,callback,now){
  for(let attempt=0;attempt<4;attempt++){
   const row=await this.read(hash,now);if(!row)throw new DomainError('Гостевая сессия истекла. Обновите страницу.',401);
   const state=JSON.parse(row.state),result=callback(state);
   const written=await this.db.prepare('UPDATE guest_workspaces SET state=?,revision=revision+1 WHERE token_hash=? AND revision=? AND expires_at>?').bind(encodedState(state),hash,row.revision,now).run();
   if(written.meta.changes===1)return result;
  }
  throw new DomainError('Данные демо изменились. Повторите действие.',409);
 }
 async reset(hash,now){
  const result=await this.db.prepare('UPDATE guest_workspaces SET state=?,revision=revision+1 WHERE token_hash=? AND expires_at>?').bind(encodedState(freshState()),hash,now).run();
  if(result.meta.changes!==1)throw new DomainError('Гостевая сессия истекла. Обновите страницу.',401);
  return {ok:true};
 }
}
function activeActor(request,state){const id=cookieValue(request,GUEST_ACTOR_COOKIE);return id&&state.users.some(u=>u.id===id)?id:'demo-candidate';}
function errorResponse(error){return Response.json({error:error instanceof DomainError?error.message:'Гостевая демонстрация временно недоступна. Попробуйте позже.'},{status:error instanceof DomainError?error.status:503,headers:guestHeaders});}
/** A separate synthetic sandbox. It never reads platform-user workspaces or real-account tables.
 * @param {Request} request
 * @param {{db:unknown, renderProfile?:(user:import('./types').User)=>Promise<Uint8Array>, now?:number}} options
 */
export async function handleGuestRequest(request,{db,renderProfile,now=Date.now()}){
 try{
  const url=new URL(request.url);
  if([...url.searchParams.keys()].some(key=>['token','session','owner','principal'].includes(key)))throw new DomainError('Гостевые ключи не передаются через адрес страницы.',400);
  if(request.headers.get('origin')&&request.headers.get('origin')!==url.origin)throw new DomainError('Источник запроса не разрешён.',403);
  if(request.headers.get('sec-fetch-site')==='cross-site')throw new DomainError('Источник запроса не разрешён.',403);
  const stateRead=request.method==='GET'&&url.pathname==='/api/guest/state';
  const actionWrite=request.method==='POST'&&url.pathname==='/api/guest/action';
  const candidatesRead=request.method==='GET'&&url.pathname==='/api/guest/candidates';
  const pdfRead=request.method==='GET'&&url.pathname==='/api/guest/profile.pdf';
  if(!stateRead&&!actionWrite&&!candidatesRead&&!pdfRead)throw new DomainError('Страница не найдена.',404);
  if(actionWrite){if(request.headers.get('origin')!==url.origin)throw new DomainError('Источник запроса не разрешён.',403);if((request.headers.get('content-type')||'').split(';')[0].trim().toLowerCase()!=='application/json')throw new DomainError('Нужен JSON-запрос.',415);}
  const repository=new GuestDemoRepository(db);
  // Lazy bounded cleanup removes only expired synthetic guest data, never personal tables.
  await repository.cleanup(now);
  const session=await repository.resolve(request,now,stateRead);
  if(!session.created)await repository.budget(session.hash,now);
  const state=JSON.parse(session.row.state),active=session.created?'demo-candidate':activeActor(request,state);
  const headers=new Headers(guestHeaders);
  if(session.created){headers.append('Set-Cookie',cookie(GUEST_COOKIE,session.token));headers.append('Set-Cookie',cookie(GUEST_ACTOR_COOKIE,'demo-candidate'));}
  if(stateRead){const data=view(state,actor(state,active));return Response.json({...data,draftIdentity:await assessmentDraftIdentity('guest',session.hash),guest:{expiresAt:session.row.expires_at,ephemeral:true,created:session.created}},{headers});}
  if(candidatesRead){const params=Object.fromEntries(url.searchParams);return Response.json({candidates:rankCandidates(state,actor(state,active),{...params,fsp:params.fsp==='true'})},{headers});}
  if(pdfRead){const user=actor(state,active);if(user.role!=='candidate')throw new DomainError('Доступен только собственный демо-PDF.',403);if(!renderProfile)throw new DomainError('PDF временно недоступен.',503);return new Response(await renderProfile(view(state,user).user),{headers:{...guestHeaders,'Content-Type':'application/pdf','Content-Disposition':'attachment; filename="fsp-guest-profile.pdf"'}});}
  const input=await readJsonBody(request);
  if(!input||typeof input!=='object'||Array.isArray(input))throw new DomainError('Некорректный запрос.');
  if(input.action==='reset-demo'){
   if(input.confirm!==true)throw new DomainError('Подтвердите сброс вымышленного демо.');
   const result=await repository.reset(session.hash,now);headers.append('Set-Cookie',cookie(GUEST_ACTOR_COOKIE,'demo-candidate'));return Response.json(result,{headers});
  }
  const result=await repository.mutate(session.hash,current=>command(current,active,input,now),now);
  if(result.switchTo)headers.append('Set-Cookie',cookie(GUEST_ACTOR_COOKIE,result.switchTo));
  return Response.json(result,{headers});
 }catch(error){return errorResponse(error);}
}
