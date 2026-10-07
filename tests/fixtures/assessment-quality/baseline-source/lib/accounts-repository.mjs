import { DomainError, upgradeState } from './domain.mjs';
import { ASSESSMENT_VERSION } from './assessment.mjs';
const TABLES=['real_accounts','real_candidate_profiles','real_employer_profiles','real_assessments','real_skill_evidence','real_invitations','real_searches'];
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const bool=value=>value?1:0;
export class AccountsRepository {
  constructor(db){this.db=db;}
  async initialize(){await this.db.prepare("INSERT OR IGNORE INTO real_revisions(id,revision,op_id) VALUES ('main',0,'')").run();}
  async snapshot(principal=null){
    await this.initialize();
    const scope=`WITH current AS (SELECT id,role FROM real_accounts WHERE issuer=? AND subject=?), visible_ids AS (
      SELECT id FROM current
      UNION SELECT p.account_id FROM real_candidate_profiles p JOIN real_accounts a ON a.id=p.account_id WHERE p.published=1 AND p.consent=1 AND p.category_confirmed=1 AND a.email_verified_at IS NOT NULL AND EXISTS(SELECT 1 FROM current WHERE role='employer')
      UNION SELECT candidate_id FROM real_invitations WHERE employer_id IN (SELECT id FROM current)
      UNION SELECT employer_id FROM real_invitations WHERE candidate_id IN (SELECT id FROM current)
    ), visible_assessments AS (SELECT id FROM real_assessments WHERE account_id IN (SELECT id FROM current) OR id IN (SELECT current_assessment_id FROM real_candidate_profiles WHERE account_id IN (SELECT id FROM visible_ids))) `;
    const predicates={real_accounts:'id IN (SELECT id FROM visible_ids)',real_candidate_profiles:'account_id IN (SELECT id FROM visible_ids)',real_employer_profiles:'account_id IN (SELECT id FROM visible_ids)',real_assessments:'id IN (SELECT id FROM visible_assessments)',real_skill_evidence:'assessment_id IN (SELECT id FROM visible_assessments)',real_invitations:'employer_id IN (SELECT id FROM current) OR candidate_id IN (SELECT id FROM current)',real_searches:'account_id IN (SELECT id FROM current)'};
    const statements=TABLES.map(table=>principal?this.db.prepare(`${scope} SELECT * FROM ${table} WHERE ${predicates[table]}`).bind(principal.issuer,principal.subject):this.db.prepare(`SELECT * FROM ${table}`));
    const results=await this.db.batch([this.db.prepare("SELECT revision FROM real_revisions WHERE id='main'"),...statements]);
    const rows=Object.fromEntries(TABLES.map((table,index)=>[table,results[index+1].results]));
    const evidences=id=>rows.real_skill_evidence.filter(e=>e.assessment_id===id).map(e=>({skill:e.skill,correct:e.correct,total:e.total,score:e.score,confirmed:!!e.confirmed}));
    const tests=rows.real_assessments.map(t=>({id:t.id,userId:t.account_id,specialization:t.specialization,grade:t.grade,createdAt:t.created_at,expiresAt:t.expires_at,completedAt:t.completed_at,score:t.score,passed:!!t.passed,assessmentVersion:t.version,questions:JSON.parse(t.questions_json),competencyResults:evidences(t.id),...(t.version!==ASSESSMENT_VERSION&&t.score===null?{invalidated:'Assessment upgraded; please restart.'}:{})}));
    const users=rows.real_accounts.map(account=>{
      const profile=(account.role==='candidate'?rows.real_candidate_profiles:rows.real_employer_profiles).find(p=>p.account_id===account.id)||{};
      const competencyResults=evidences(profile.current_assessment_id);
      const currentAssessment=tests.find(t=>t.id===profile.current_assessment_id);
      const assessmentVersion=profile.current_assessment_id?currentAssessment?.assessmentVersion:ASSESSMENT_VERSION;
      return {id:account.id,role:account.role,name:account.name,email:account.email,contact:account.email,verified:account.email_verified_at!==null,published:!!profile.published,consent:!!profile.consent,industry:'ИТ',specialization:profile.specialization||'Backend',grade:profile.grade||'Junior',skills:competencyResults.filter(item=>item.confirmed).map(item=>item.skill),competencyResults,score:profile.score||0,categoryConfirmed:!!profile.category_confirmed,gradeChangedAt:profile.grade_changed_at,currentAssessmentId:profile.current_assessment_id,fsp:false,fspId:null,about:profile.about||'',experience:profile.experience||0,softSkills:profile.soft_skills||'',company:profile.company||'',description:profile.description||'',evidenceSource:profile.current_assessment_id?'assessment':'unassessed',assessmentVersion,attempts:tests.filter(t=>t.userId===account.id&&t.completedAt!==null).sort((a,b)=>b.completedAt-a.completedAt).map(t=>({id:t.id,specialization:t.specialization,grade:t.grade,score:t.score,passed:t.passed,competencyResults:t.competencyResults,assessmentVersion:t.assessmentVersion,at:t.completedAt,stale:t.assessmentVersion!==ASSESSMENT_VERSION,...(t.invalidated?{invalidated:t.invalidated}:{})}))};
    });
    const invitations=rows.real_invitations.map(i=>({id:i.id,employerId:i.employer_id,candidateId:i.candidate_id,candidateName:i.candidate_name,company:i.company,employerContact:i.employer_contact,description:i.description,salaryFrom:i.salary_from,salaryTo:i.salary_to,salaryBasis:i.salary_basis||'unspecified',status:i.status,createdAt:i.created_at,updatedAt:i.updated_at}));
    const searches=rows.real_searches.map(s=>({id:s.id,userId:s.account_id,filters:JSON.parse(s.filters_json),candidateIds:JSON.parse(s.candidate_ids_json),at:s.created_at})).sort((a,b)=>b.at-a.at);
    return {revision:results[0].results[0].revision,rows,state:upgradeState({users,tests,invitations,searches,outbox:[]})};
  }
  accountFor(snapshot,principal){const row=snapshot.rows.real_accounts.find(account=>account.issuer===principal.issuer&&account.subject===principal.subject);if(!row)throw new DomainError('Сначала создайте собственный аккаунт.',403);return row;}
  guardedInsert(table,row,keys,operation){
    const columns=Object.keys(row),updates=columns.filter(column=>!keys.includes(column)).map(column=>`${column}=excluded.${column}`).join(',');
    return this.db.prepare(`INSERT INTO ${table} (${columns.join(',')}) SELECT ${columns.map(()=>'?').join(',')} WHERE EXISTS(SELECT 1 FROM real_revisions WHERE id='main' AND op_id=?) ON CONFLICT(${keys.join(',')}) DO ${updates?`UPDATE SET ${updates}`:'NOTHING'}`).bind(...columns.map(column=>row[column]??null),operation);
  }
  guard(revision,operation){return this.db.prepare("UPDATE real_revisions SET revision=revision+1,op_id=? WHERE id='main' AND revision=?").bind(operation,revision);}
  async transaction(revision,build){const operation=crypto.randomUUID();const results=await this.db.batch([this.guard(revision,operation),...build(operation)]);if(results[0].meta.changes!==1)throw new DomainError('Данные изменились. Повторите действие.',409);return results;}
  async save(snapshot,state){
    const desired={
      real_candidate_profiles:state.users.filter(u=>u.role==='candidate').map(u=>({account_id:u.id,about:u.about,experience:u.experience,soft_skills:u.softSkills,consent:bool(u.consent),published:bool(u.published),specialization:u.specialization,grade:u.grade,score:u.score,category_confirmed:bool(u.categoryConfirmed),grade_changed_at:u.gradeChangedAt??null,current_assessment_id:u.currentAssessmentId??null})),
      real_employer_profiles:state.users.filter(u=>u.role==='employer').map(u=>({account_id:u.id,company:u.company,description:u.description})),
      real_assessments:state.tests.map(t=>({id:t.id,account_id:t.userId,specialization:t.specialization,grade:t.grade,created_at:t.createdAt,expires_at:t.expiresAt,completed_at:t.completedAt??null,score:t.score??null,passed:t.completedAt?bool(t.passed):null,version:t.assessmentVersion,questions_json:JSON.stringify(t.questions)})),
      real_skill_evidence:state.tests.flatMap(t=>(t.competencyResults||[]).map(e=>({assessment_id:t.id,account_id:t.userId,skill:e.skill,correct:e.correct,total:e.total,score:e.score,confirmed:bool(e.confirmed)}))),
      real_invitations:state.invitations.map(i=>({id:i.id,employer_id:i.employerId,candidate_id:i.candidateId,candidate_name:i.candidateName,company:i.company,employer_contact:i.employerContact,description:i.description,salary_from:i.salaryFrom,salary_to:i.salaryTo,salary_basis:i.salaryBasis||'unspecified',status:i.status,created_at:i.createdAt,updated_at:i.updatedAt??null})),
      real_searches:state.searches.map(s=>({id:s.id,account_id:s.userId,filters_json:JSON.stringify(s.filters),candidate_ids_json:JSON.stringify(s.candidateIds),created_at:s.at})),
    };
    return this.transaction(snapshot.revision,operation=>Object.entries(desired).flatMap(([table,rows])=>{
      const keys=table==='real_skill_evidence'?['assessment_id','skill']:table.endsWith('_profiles')?['account_id']:['id'];
      const sameKey=(a,b)=>keys.every(key=>a[key]===b[key]);
      const changes=rows.filter(row=>{const old=snapshot.rows[table].find(item=>sameKey(item,row));return !old||!equal(Object.fromEntries(Object.keys(row).map(key=>[key,old[key]])),row);}).map(row=>this.guardedInsert(table,row,keys,operation));
      for(const old of snapshot.rows[table])if(!rows.some(row=>sameKey(row,old)))changes.push(this.db.prepare(`DELETE FROM ${table} WHERE ${keys.map(key=>`${key}=?`).join(' AND ')} AND EXISTS(SELECT 1 FROM real_revisions WHERE id='main' AND op_id=?)`).bind(...keys.map(key=>old[key]),operation));
      return changes;
    }));
  }
}
