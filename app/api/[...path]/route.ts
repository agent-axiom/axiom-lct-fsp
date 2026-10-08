import { assessmentDraftIdentity } from '@/lib/assessment-draft-identity.mjs';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { load, mutate } from '@/lib/storage';
import { actor, command, view, rankCandidates, DomainError } from '@/lib/domain.mjs';
import { readJsonBody } from '@/lib/http-body.mjs';
export const dynamic='force-dynamic';
const safeHeaders={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
async function identity(request:Request){const user=await getChatGPTUser();if(!user)throw new DomainError('Нужно войти в ChatGPT.',401);const cookie=request.headers.get('cookie')||'';const active=cookie.split(';').map(x=>x.trim()).find(x=>x.startsWith('fsp_actor='))?.slice(10)||'demo-candidate';return {owner:user.userId,active};}
function failure(e:unknown){if(e instanceof DomainError)return Response.json({error:e.message},{status:e.status,headers:safeHeaders});console.error('FSP API failed',e);return Response.json({error:'Хранилище временно недоступно. Введённые данные сохранены в форме; повторите действие.'},{status:503,headers:safeHeaders});}
export async function GET(request:Request){try{const {owner,active}=await identity(request);const {state}=await load(owner);const u=actor(state,active);const path=new URL(request.url).pathname;
 if(path==='/api/state')return Response.json({...view(state,u),draftIdentity:await assessmentDraftIdentity('demo',owner)},{headers:safeHeaders});
 if(path==='/api/candidates'){const params=Object.fromEntries(new URL(request.url).searchParams);return Response.json({candidates:rankCandidates(state,u,{...params,fsp:params.fsp==='true'})},{headers:safeHeaders});}
 if(path==='/api/profile.pdf'){if(u.role!=='candidate')throw new DomainError('Доступен только собственный PDF-профиль.',403);const {makePdf}=await import('@/lib/pdf');return new Response(await makePdf(view(state,u).user),{headers:{...safeHeaders,'Content-Type':'application/pdf','Content-Disposition':'attachment; filename="fsp-demo-profile.pdf"'}});}
 throw new DomainError('Страница не найдена.',404);
 }catch(e){return failure(e);}}
export async function POST(request:Request){try{const {owner,active}=await identity(request);const url=new URL(request.url);if(request.headers.get('origin')!==url.origin)throw new DomainError('Источник запроса не разрешён.',403);if(url.pathname!=='/api/action')throw new DomainError('Не найдено.',404);const input=await readJsonBody(request);const result=await mutate(owner,s=>command(s,active,input));const headers:Record<string,string>={...safeHeaders};if(result.switchTo)headers['Set-Cookie']=`fsp_actor=${result.switchTo}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=86400`;return Response.json(result,{headers});}catch(e){return failure(e);}}
