import { makeQuestions, gradeAssessment, answerMatches, ASSESSMENT_VERSION, TEST_MINUTES } from './assessment.mjs';
import { parseRequirements, matchCandidate } from './matching.mjs';
import {demoAchievement,verifiedDemoAchievements} from './achievements.mjs';
import {publicAssessmentEvidence,publicCompetency} from './evidence.mjs';
export { makeQuestions, parseRequirements };
export const SPECS = ['Backend', 'Frontend'];
export const GRADES = ['Junior', 'Middle', 'Senior'];
export const INTERVAL = 90 * 86400000;
export class DomainError extends Error { constructor(message, status=400) { super(message); this.status=status; } }
const demand = (ok,msg,status=400) => { if(!ok) throw new DomainError(msg,status); };
const str = (x,max=500) => typeof x==='string'?x.trim().slice(0,max):'';
export function freshState() {
 const candidates = [
  ['demo-candidate','Алексей · демо','Backend','Middle',85,['Python','SQL'],false],
  ['candidate-2','Мария · демо','Frontend','Middle',92,['TypeScript','React'],true],
  ['candidate-3','Илья · демо','Backend','Senior',90,['Python','SQL','Docker'],true],
  ['candidate-4','Анна · демо','Backend','Junior',76,['Python','SQL'],false],
  ['candidate-5','Денис · демо','Frontend','Junior',80,['TypeScript','React'],false],
  ['candidate-6','Ольга · демо','Backend','Middle',94,['Python','SQL'],true],
 ].map(([id,name,specialization,grade,score,skills,fsp])=>({id,role:'candidate',name,email:id+'@example.test',contact:id+'@example.test',verified:true,published:true,consent:true,industry:'ИТ',specialization,grade,score,skills,competencyResults:skills.map(skill=>({skill,score,correct:null,total:null,confirmed:true})),evidenceSource:'synthetic_seed',assessmentVersion:ASSESSMENT_VERSION,fsp,about:'Синтетический профиль для проверки сценария.',experience:grade==='Senior'?6:grade==='Middle'?3:1,softSkills:'Командная работа',categoryConfirmed:true,gradeChangedAt:null,attempts:[],fspId:fsp?'DEMO-'+id:null}));
 for(const candidate of candidates)candidate.fspAchievements=candidate.fsp?[demoAchievement(candidate)]:[];
 return {users:[...candidates,{id:'demo-employer',role:'employer',name:'Команда «Орбита» · демо',company:'Орбита · демо',email:'company@example.test',contact:'team@example.test',description:'Разрабатываем цифровые продукты.',verified:true}],invitations:[],tests:[],outbox:[],searches:[]};
}
export function actor(state,id) { const u=state.users.find(x=>x.id===id); demand(u,'Выберите демонстрационный кабинет.',401); return u; }
const role = (u,r) => demand(u.role===r,'Нет доступа для этой роли.',403);
function verified(u) { demand(u.verified,'Сначала подтвердите демо-адрес.'); }
export function publicCandidate(c,accepted=false,state={tests:[]}) {
 const safe={id:c.id,name:c.name,specialization:c.specialization,grade:c.grade,score:c.score,skills:c.skills,fsp:c.fsp,fspAchievements:verifiedDemoAchievements(c),about:c.about,experience:c.experience,softSkills:c.softSkills,categoryConfirmed:c.categoryConfirmed,competencyResults:(c.competencyResults||[]).map(publicCompetency),evidenceSource:c.evidenceSource||'unknown',evidence:publicAssessmentEvidence(state,c)};
 if(accepted) safe.contact=c.contact;
 return safe;
}
export function rankCandidates(state, employer, filters={}) {
 role(employer,'employer'); verified(employer);
 const requirements=parseRequirements(filters);
 return state.users.filter(c=>c.role==='candidate'&&c.verified&&c.published&&c.consent&&c.categoryConfirmed)
 .filter(c=>(!filters.specialization||c.specialization===filters.specialization)&&(!filters.grade||c.grade===filters.grade)&&(!filters.fsp||verifiedDemoAchievements(c).length>0)&&requirements.explicitSkills.every(t=>c.skills.some(s=>s.toLowerCase()===t.toLowerCase())))
 .map(c=>{const accepted=state.invitations.some(i=>i.employerId===employer.id&&i.candidateId===c.id&&i.status==='accepted');return {...publicCandidate(c,accepted,state),...matchCandidate(c,requirements)};}).filter(c=>c.evidenceSource!=='assessment'||c.evidence.status==='current').sort((a,b)=>b.match-a.match||a.id.localeCompare(b.id));
}
// Old banks cannot substantiate current evidence. Keep the recorded grade and
// history, but require reassessment before presenting old results as confirmed.
export function upgradeState(state) {
 for(const user of state.users) {
  if(user.role!=='candidate'||user.assessmentVersion===ASSESSMENT_VERSION)continue;
  if(user.attempts?.length||user.evidenceSource==='assessment'||user.currentAssessmentId) {for(const attempt of user.attempts||[])attempt.stale=true;user.categoryConfirmed=false;user.skills=[];user.score=0;user.competencyResults=[];user.evidenceSource='legacy_retest_required';}
  else {user.competencyResults=(user.skills||[]).map(skill=>({skill,score:user.score,correct:null,total:null,confirmed:true}));user.evidenceSource='synthetic_seed';}
  user.assessmentVersion=ASSESSMENT_VERSION;
 }
 for(const test of state.tests) if(test.assessmentVersion!==ASSESSMENT_VERSION&&!test.completedAt) {test.completedAt=Date.now();test.invalidated='Assessment upgraded; please restart.';}
 return state;
}
export function view(state,u) {
 const invitations=state.invitations.filter(i=>u.role==='employer'?i.employerId===u.id:i.candidateId===u.id).map(i=>({...i,...(u.role==='employer'&&i.status==='accepted'&&actor(state,i.candidateId).consent?{candidateContact:actor(state,i.candidateId).contact}:{})}));
 const result={user:u.role==='candidate'?{...u,evidence:publicAssessmentEvidence(state,u)}:u,invitations,accounts:state.users.map(a=>({id:a.id,role:a.role,name:a.name})),outbox:state.outbox.filter(m=>m.userId===u.id),demo:true};
 // The account switcher is a sandbox control, not a candidate data endpoint.
 if(u.role==='candidate') {result.accounts=state.users.filter(a=>a.id===u.id||a.id==='demo-employer').map(a=>({id:a.id,role:a.role,name:a.name}));result.test=state.tests.find(t=>t.userId===u.id&&!t.completedAt&&t.expiresAt>Date.now());if(result.test)result.test=stripTest(result.test);result.outbox=state.outbox.filter(m=>m.userId===u.id);}
 else result.searches=state.searches.filter(s=>s.userId===u.id);
 return result;
}
export function stripTest(t) {return {id:t.id,grade:t.grade,specialization:t.specialization,assessmentVersion:t.assessmentVersion,createdAt:t.createdAt,expiresAt:t.expiresAt,questions:t.questions.map(question=>({id:question.id,text:question.text,skill:question.skill,version:question.version,format:question.format||'text',...(question.choices?{choices:question.choices}:{})}))};}
export function command(state,id,input,now=Date.now()) {
 demand(input&&typeof input==='object','Некорректный запрос.');
 const action=input.action;
 if(action==='register') {
  demand(state.users.length<40,'Лимит демо-профилей достигнут.');
  demand(['candidate','employer'].includes(input.role),'Выберите роль.');
  const name=str(input.name,80); demand(name.length>=2,'Введите демонстрационное имя.');
  const email=str(input.email,100).toLowerCase();demand(/^[a-z0-9._+-]+@example\.test$/.test(email),'Для демо используйте адрес @example.test.');
  demand(!state.users.some(u=>u.email===email),'Этот демо-адрес уже используется.');
  const userId=crypto.randomUUID(),code=String(crypto.getRandomValues(new Uint32Array(1))[0]%900000+100000);
  state.users.push({id:userId,role:input.role,name,email,contact:email,verified:false,published:false,consent:false,industry:'ИТ',specialization:'Backend',grade:'Junior',skills:[],competencyResults:[],assessmentVersion:ASSESSMENT_VERSION,evidenceSource:'unassessed',fsp:false,score:0,attempts:[],categoryConfirmed:false,about:'',experience:0,softSkills:'',company:name,description:''});
  state.outbox.push({userId,code,createdAt:now,expiresAt:now+600000,tries:0,label:'Демонстрационная почта. Настоящее письмо не отправлялось.'});
  return {switchTo:userId};
 }
 const u=actor(state,id);
 if(action==='switch') {actor(state,input.id);return {switchTo:input.id};}
 if(action==='verify') {const m=state.outbox.find(x=>x.userId===u.id);demand(m&&!u.verified&&now<m.expiresAt&&m.tries<5,'Код недоступен или истёк. Создайте новый демо-профиль.');m.tries++;if(str(input.code)!==m.code)return {verificationError:'Неверный демо-код.'};u.verified=true;state.outbox=state.outbox.filter(x=>x.userId!==u.id);return {ok:true};}
 verified(u);
 if(action==='profile') {
  role(u,'candidate'); demand(typeof input.consent==='boolean'&&typeof input.published==='boolean','Укажите настройки приватности.');
  u.about=str(input.about,1500);u.softSkills=str(input.softSkills);u.experience=Math.max(0,Math.min(50,Number(input.experience)||0));u.consent=input.consent;u.published=input.published&&input.consent;
  demand(!input.contact||/^[a-z0-9._+-]+@example\.test$/i.test(input.contact),'Контакт должен быть демонстрационным @example.test.');u.contact=str(input.contact,100)||u.email;
  return {ok:true};
 }
 if(action==='company') {role(u,'employer');u.company=str(input.company,100);demand(u.company.length>=2,'Введите название компании.');u.description=str(input.description,1500);demand(/^[a-z0-9._+-]+@example\.test$/i.test(input.contact),'Используйте контакт @example.test.');u.contact=str(input.contact,100);return {ok:true};}
 if(action==='fsp') {role(u,'candidate');u.fsp=!!input.linked;u.fspId=u.fsp?'DEMO-'+u.id:null;u.fspAchievements=u.fsp?[demoAchievement(u)]:[];return {ok:true};}
 if(action==='test-start') {
  role(u,'candidate');demand(SPECS.includes(input.specialization)&&GRADES.includes(input.grade),'Выберите специализацию и грейд.');
  demand(!u.gradeChangedAt||now-u.gradeChangedAt>=INTERVAL||input.grade===u.grade,'Подтверждённый грейд можно менять раз в 90 дней.');
  const active=state.tests.find(t=>t.userId===u.id&&!t.completedAt&&t.expiresAt>now);if(active)return {test:stripTest(active)};
  demand(state.tests.filter(t=>t.userId===u.id&&now-t.createdAt<3600000).length<10,'Не больше 10 демо-попыток в час.');
  const test={id:crypto.randomUUID(),userId:u.id,grade:input.grade,specialization:input.specialization,createdAt:now,expiresAt:now+TEST_MINUTES*60000,assessmentVersion:ASSESSMENT_VERSION,questions:makeQuestions(input.specialization,input.grade,crypto.getRandomValues(new Uint32Array(1))[0])};state.tests.push(test);return {test:stripTest(test)};
 }
 if(action==='test-submit') {
  role(u,'candidate');const t=state.tests.find(t=>t.id===input.testId&&t.userId===u.id);demand(t,'Тест не найден.',404);demand(!t.completedAt&&t.expiresAt>now,'Тест завершён или время истекло.');
  demand(input.answers&&t.questions.every(q=>typeof input.answers[q.id]==='string'&&input.answers[q.id].trim()),'Ответьте на все вопросы.');
  demand(t.assessmentVersion===ASSESSMENT_VERSION,'Банк тестов обновлён. Начните новую попытку.',409);
  const {score,passed,competencyResults}=gradeAssessment(t,input.answers);t.completedAt=now;t.score=score;t.passed=passed;t.competencyResults=competencyResults;t.questions=t.questions.map(question=>({...question,correct:answerMatches(question,input.answers[question.id])}));u.attempts.unshift({id:t.id,specialization:t.specialization,grade:t.grade,score,passed,competencyResults,assessmentVersion:ASSESSMENT_VERSION,at:now});
  if(passed){if(u.categoryConfirmed&&u.grade!==t.grade)u.gradeChangedAt=now;u.specialization=t.specialization;u.grade=t.grade;u.score=score;u.categoryConfirmed=true;u.competencyResults=competencyResults;u.skills=competencyResults.filter(result=>result.confirmed).map(result=>result.skill);u.assessmentVersion=ASSESSMENT_VERSION;u.evidenceSource='assessment';u.currentAssessmentId=t.id;}
  return {score,passed,competencyResults,message:passed?'Категория и навыки подтверждены отдельно по каждому блоку.':'Категория не изменена. Нужно минимум 75/100 в целом и 2 из 3 в каждом навыке. Повторите этот уровень или выберите меньший, если 90-дневное ограничение смены не действует. Провал не запускает ограничение.'};
 }
 if(action==='search') {role(u,'employer');const filters={need:str(input.need,1500),specialization:SPECS.includes(input.specialization)?input.specialization:'',grade:GRADES.includes(input.grade)?input.grade:'',skills:str(input.skills),fsp:!!input.fsp};const candidates=rankCandidates(state,u,filters);state.searches.unshift({id:crypto.randomUUID(),userId:u.id,filters,at:now,candidateIds:candidates.map(c=>c.id)});state.searches=[...state.searches.filter(s=>s.userId===u.id).slice(0,40),...state.searches.filter(s=>s.userId!==u.id)];return {candidates,filters,requirements:parseRequirements(filters)};}
 if(action==='invite') {
  role(u,'employer');const c=actor(state,input.candidateId);demand(c.role==='candidate'&&c.categoryConfirmed&&c.consent&&c.published&&c.verified,'Кандидат недоступен.',404);
  const from=Number(input.salaryFrom),to=Number(input.salaryTo);demand(Number.isInteger(from)&&Number.isInteger(to)&&from>0&&to>=from&&to<=10000000,'Укажите корректный диапазон зарплаты от–до в рублях.');
  const salaryBasis=input.salaryBasis??'gross';demand(['gross','net'].includes(salaryBasis),'Укажите зарплату до налогов или на руки.');
  const description=str(input.description,2000);demand(description.length>=15,'Опишите предложение, минимум 15 символов.');demand(u.company&&u.contact,'Сначала заполните профиль компании.');
  demand(!state.invitations.some(i=>i.employerId===u.id&&i.candidateId===c.id&&['sent','viewed','accepted'].includes(i.status)),'Уже есть активное приглашение.');
  const invitation={id:crypto.randomUUID(),employerId:u.id,candidateId:c.id,candidateName:c.name,company:u.company,employerContact:u.contact,description,salaryFrom:from,salaryTo:to,salaryBasis,status:'sent',createdAt:now};state.invitations.push(invitation);return {invitation};
 }
 if(action==='invitation-status') {role(u,'candidate');const i=state.invitations.find(x=>x.id===input.id&&x.candidateId===u.id);demand(i,'Приглашение не найдено.',404);demand(['viewed','accepted','declined'].includes(input.status),'Некорректный статус.');demand(['sent','viewed'].includes(i.status),'Решение уже принято.',409);if(input.status==='accepted')demand(u.consent,'Нужно согласие на раскрытие контакта.');i.status=input.status;i.updatedAt=now;return {ok:true};}
 throw new DomainError('Неизвестное действие.',404);
}
