// UI-only shortcuts. This is never an identity or authorization source.
export const DEMO_NAVIGATION_KEY = 'fsp.demo-navigation.v1';
export const DEMO_SEARCH_EXAMPLES = [
 {label:'Backend · Python / SQL',filters:{need:'Backend Middle Python SQL',specialization:'Backend',grade:'Middle',skills:'Python, SQL',fsp:false}},
 {label:'Frontend · Middle',filters:{need:'Middle Frontend TypeScript React',specialization:'Frontend',grade:'Middle',skills:'',fsp:false}},
 {label:'Проверить пробел: Kubernetes',filters:{need:'Backend Middle Python SQL Kubernetes',specialization:'Backend',grade:'Middle',skills:'',fsp:false}},
];
const defaults=()=>({candidate:'demo-candidate',employer:'demo-employer'});
const validId=value=>typeof value==='string'&&/^[\w-]{1,100}$/.test(value);
/** @param {() => Storage} [getStorage] */
export function createDemoNavigation(getStorage=()=>window.sessionStorage){
 let binding='',roles=defaults();
 const write=()=>{try{getStorage().setItem(DEMO_NAVIGATION_KEY,JSON.stringify({binding,roles}));}catch{/* UI remains usable without storage. */}};
 return {
  /** @param {string} api @param {import('./types').WorkspaceData} data */
  reconcile(api,data){
   const next=['/api','/api/guest'].includes(api)&&/^[a-f0-9]{64}$/.test(data.draftIdentity||'')?`${api}:${data.draftIdentity}`:'';
   if(next!==binding){roles=defaults();binding=next;if(binding)try{const raw=getStorage().getItem(DEMO_NAVIGATION_KEY);const stored=raw&&raw.length<1000?JSON.parse(raw):null;if(stored?.binding===binding&&validId(stored.roles?.candidate)&&validId(stored.roles?.employer))roles={candidate:stored.roles.candidate,employer:stored.roles.employer};}catch{/* Ignore malformed or unavailable storage. */}}
   if(binding&&validId(data.user.id)){roles[data.user.role]=data.user.id;write();}
   return {...roles};
  },
  /** @param {'candidate'|'employer'} role @param {string} id */
  select(role,id){if(binding&&validId(id)){roles[role]=id;write();}return {...roles};},
  clear(){binding='';roles=defaults();try{getStorage().removeItem(DEMO_NAVIGATION_KEY);}catch{try{getStorage().setItem(DEMO_NAVIGATION_KEY,'');}catch{/* Best effort. */}}},
 };
}

/** Ask before the existing draft-clear behavior; cancellation has no side effects.
 * @param {string} action @param {boolean} activeCandidateTest
 * @param {Record<string,string>} answers @param {(message:string)=>boolean} confirm
 */
export function confirmDraftNavigation(action,activeCandidateTest,answers,confirm){
 if(!['switch','register'].includes(action)||!activeCandidateTest||!Object.values(answers).some(answer=>answer.trim()))return true;
 return confirm('При смене профиля введённые ответы будут удалены. Незавершённая попытка и её срок сохранятся, но ответы придётся ввести заново. Продолжить?');
}
