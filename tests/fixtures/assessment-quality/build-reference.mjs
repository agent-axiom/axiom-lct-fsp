import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {referenceFor} from './reference-oracle.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(process.argv[2]||path.join(here,'../../fsp-source-recovery'));
const {makeQuestions,BLUEPRINT,ASSESSMENT_VERSION}=await import(pathToFileURL(path.join(root,'lib/assessment.mjs')));
const cases=new Map();
for(const specialization of Object.keys(BLPRINT()))for(const grade of ['Junior','Middle','Senior'])for(let seed=20261006;seed<20261106;seed++){
 const questions=makeQuestions(specialization,grade,seed);
 for(const question of questions)if(!cases.has(question.conceptId)){
  const reference=referenceFor(question,questions);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Deliberately discard private answer keys from the public reference prompt.
  const {answer,alternatives,conceptId,applied,...publicQuestion}=question; // Keys are deliberately discarded, never copied to labels.
  cases.set(conceptId,{id:conceptId,author:'AI assessment reviewer, отдельный от автора исходного evaluator',authorType:'AI, не человек-эксперт',labelDate:'2026-10-06',specialization,grade,seed,publicQuestion,expectedAnswer:reference.answer,expectedCorrect:true,rationale:reference.rationale,cognitiveDemand:reference.demand,parameters:reference.parameters});
 }
}
function BLPRINT(){return BLUEPRINT;}
const corpus={schemaVersion:1,assessmentVersion:ASSESSMENT_VERSION,sourceSHA256:createHash('sha256').update(readFileSync(path.join(root,'lib/assessment.mjs'))).digest('hex'),author:'AI assessment reviewer',independence:'Новые labels получены отдельной семантической реализацией; автор прочитал исходник. Нет слепой разметки, независимого человека-эксперта, реальных кандидатов или психометрической валидации. 144 строки представляют те же семейства исходного банка, а не 144 независимых компетенции.',cases:[...cases.values()].sort((a,b)=>a.id.localeCompare(b.id))};
writeFileSync(path.join(here,'reference-set.json'),JSON.stringify(corpus,null,2)+'\n');console.log(`Saved ${cases.size} author-labeled reference cases`);
