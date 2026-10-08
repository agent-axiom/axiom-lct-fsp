import {ASSESSMENT_VERSION,BLUEPRINT} from './assessment.mjs';

const finite=value=>typeof value==='number'&&Number.isFinite(value);
export function publicCompetency(result={}) {
  result=result||{};
  return {skill:String(result.skill||''),score:finite(result.score)?result.score:0,correct:Number.isInteger(result.correct)?result.correct:null,total:Number.isInteger(result.total)?result.total:null,confirmed:result.confirmed===true};
}

// A public receipt, not a copy of the assessment record. Never include prompts,
// answers, aliases, concept IDs, active tests, attempt history, or contacts here.
export function publicAssessmentEvidence(state,candidate) {
  const base={source:candidate.evidenceSource||'unknown',status:'unavailable',assessmentId:null,completedAt:null,bankVersion:null,specialization:candidate.specialization||'',grade:candidate.grade||'',score:null,totalCorrect:null,totalQuestions:null,skills:[],limitation:'Учебный банк: результат не доказывает профессиональную пригодность.'};
  if(candidate.evidenceSource==='synthetic_seed')return {...base,status:'synthetic',skills:(candidate.competencyResults||[]).map(result=>({...publicCompetency(result),correct:null,total:null,confirmed:false,applied:null,knowledge:null,tasks:null}))};
  if(candidate.evidenceSource==='legacy_retest_required')return {...base,status:'stale'};
  if(candidate.evidenceSource!=='assessment'||!candidate.categoryConfirmed)return base;
  const consistent=test=>test.userId===candidate.id&&test.passed===true&&finite(test.completedAt)&&test.completedAt>0&&test.assessmentVersion===ASSESSMENT_VERSION&&test.specialization===candidate.specialization&&test.grade===candidate.grade&&test.score===candidate.score;
  const ownTests=(state.tests||[]).filter(consistent);
  // Pre-v0.5 demo successes have no currentAssessmentId. Only a matching passed
  // record is an eligible fallback; a newer failed attempt is never evidence.
  const assessment=candidate.currentAssessmentId?ownTests.find(test=>test.id===candidate.currentAssessmentId):ownTests.sort((a,b)=>b.completedAt-a.completedAt)[0];
  if(!assessment||!Array.isArray(assessment.questions)||assessment.questions.length!==12||assessment.questions.some(q=>!q||typeof q!=='object'))return base;
  const skills=(assessment.competencyResults||[]).map(result=>{
    const clean=publicCompetency(result),questions=(assessment.questions||[]).filter(q=>q.skill===clean.skill);
    const hasTaskOutcomes=questions.length===clean.total&&questions.every(q=>typeof q.correct==='boolean');
    const count=applied=>{const selected=questions.filter(q=>(q.applied===true)===applied);return {correct:selected.filter(q=>q.correct).length,total:selected.length};};
    const tasks=hasTaskOutcomes?questions.map(question=>({number:assessment.questions.indexOf(question)+1,kind:question.applied===true?'applied':'knowledge',score:question.correct?1:0,maxScore:1})):null;
    return {...clean,applied:hasTaskOutcomes?count(true):null,knowledge:hasTaskOutcomes?count(false):null,tasks};
  });
  const expected=BLUEPRINT[assessment.specialization]||[];
  if(!Array.isArray(candidate.skills)||candidate.skills.length!==expected.length||new Set(candidate.skills).size!==expected.length||candidate.skills.some(skill=>!expected.includes(skill)))return base;
  if(skills.length!==expected.length||new Set(skills.map(skill=>skill.skill)).size!==expected.length||skills.some(skill=>!expected.includes(skill.skill)||skill.total!==3||skill.correct===null||skill.correct<2||skill.correct>3||!skill.confirmed||skill.score!==Math.round(skill.correct/skill.total*100)))return base;
  const totalCorrect=skills.reduce((sum,r)=>sum+r.correct,0),totalQuestions=skills.reduce((sum,r)=>sum+r.total,0);
  if(Math.round(totalCorrect/totalQuestions*100)!==assessment.score||assessment.score<75)return base;
  if(skills.some(skill=>skill.applied&&(skill.applied.total!==2||skill.knowledge.total!==1||skill.applied.correct+skill.knowledge.correct!==skill.correct)))return base;
  return {...base,status:'current',assessmentId:assessment.id,completedAt:assessment.completedAt,bankVersion:assessment.assessmentVersion,score:assessment.score,totalCorrect,totalQuestions,skills};
}
