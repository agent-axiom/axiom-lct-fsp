import {writeFileSync} from 'node:fs';
import {makeQuestions,gradeAssessment,BLUEPRINT,ASSESSMENT_VERSION} from '../lib/assessment.mjs';
import {stripTest} from '../lib/domain.mjs';
const recipes={
  old_first_yes:q=>/да\/нет/.test(q.text)?'да':q.text.match(/:\s*([^:]+?)\s+или\s+/)?.[1]||'не знаю',
  old_first_no:q=>/да\/нет/.test(q.text)?'нет':q.text.match(/:\s*([^:]+?)\s+или\s+/)?.[1]||'не знаю',
  first_option:q=>q.choices?.[0]||'не знаю',
  last_option:q=>q.choices?.at(-1)||'не знаю',
  longest_option:q=>q.choices?.slice().sort((a,b)=>b.length-a.length)[0]||'не знаю',
  always_yes:()=> 'да',always_no:()=> 'нет',
  first_number:q=>q.choices?.[0]||q.text.match(/-?\d+/)?.[0]||'не знаю',
  last_number:q=>q.choices?.[0]||q.text.match(/-?\d+/g)?.at(-1)||'не знаю',
};
const seedIntervals=[[0,1000],[900001,901001]],rows=[];
for(const specialization of Object.keys(BLUEPRINT))for(const grade of ['Junior','Middle','Senior'])for(const interval of seedIntervals){
  const stats=Object.fromEntries(Object.keys(recipes).map(name=>[name,{passes:0,minScore:100,maxScore:0,totalScore:0}]));
  for(let seed=interval[0];seed<interval[1];seed++){
    const questions=makeQuestions(specialization,grade,seed),publicQuestions=stripTest({questions}).questions;
    for(const [name,predict]of Object.entries(recipes)){
      const result=gradeAssessment({specialization,questions},Object.fromEntries(publicQuestions.map(q=>[q.id,predict(q)]))),s=stats[name];
      s.passes+=Number(result.passed);s.minScore=Math.min(s.minScore,result.score);s.maxScore=Math.max(s.maxScore,result.score);s.totalScore+=result.score;
    }
  }
  rows.push({specialization,grade,seedInterval:interval,attemptsPerRecipe:interval[1]-interval[0],stats});
}
const result={assessmentVersion:ASSESSMENT_VERSION,disclaimer:'Developer-authored synthetic adversarial checks. Seed/recipe repetitions are correlated, not independent cases or expert/psychometric validation. The second seed interval was not used when authoring the bank; recipe families remain known. Public DTOs only are supplied to the recipes.',totalRecipeAttemptEvaluations:rows.length*1000*Object.keys(recipes).length,rows};
console.log(JSON.stringify(result,null,2));
if(process.argv.includes('--write'))writeFileSync(new URL('../docs/assessment-adversarial-evaluation.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
