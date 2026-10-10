import test from 'node:test';
import assert from 'node:assert/strict';
import {freshReference,publicKey} from './fixtures/assessment-v5/fresh-oracle.mjs';
import {semanticCases,boundaryCases} from './fixtures/assessment-v5/semantic-cases.mjs';
import {legacyReferenceCache} from './fixtures/assessment-v5/legacy-reference.mjs';
import {makeQuestions,answerMatches,gradeAssessment,BLUEPRINT,ASSESSMENT_VERSION} from '../lib/assessment.mjs';
import {stripTest,freshState,actor,upgradeState} from '../lib/domain.mjs';
for(const [skill,grade,data,expected]of [...semanticCases,...boundaryCases])test(`independent public oracle: ${skill} ${grade} ${JSON.stringify(data)}`,()=>{
 const publicQuestion={skill,text:`Проверочный пример\nДанные: ${JSON.stringify(data)}`};
 assert.equal(freshReference(publicQuestion,grade),String(expected));
 assert.notEqual(freshReference(publicQuestion,grade),String(expected+1));
});
test('v5 generated labels agree with public-only independent oracle and reject wrong answers',()=>{
 assert.equal(ASSESSMENT_VERSION,5);
 const covered=new Set();
 for(const spec of Object.keys(BLUEPRINT))for(const grade of ['Junior','Middle','Senior']){
  const legacy=legacyReferenceCache(spec,grade);
  for(let seed=972000;seed<972300;seed++){
   const questions=makeQuestions(spec,grade,seed),dto=stripTest({questions}).questions;
   assert.equal(questions.length,12);
   for(const skill of BLUEPRINT[spec]){
    const skillQs=questions.filter(q=>q.skill===skill);
    assert.equal(skillQs.length,3);
    assert.equal(skillQs.filter(q=>q.conceptId.includes('-fresh-')).length,1);
    assert.equal(skillQs.filter(q=>q.conceptId.includes('-applied-')).length,1);
    assert.equal(skillQs.filter(q=>q.conceptId.includes('-knowledge-')).length,1);
   }
   const answers={};
   for(const q of questions){
    const pub=dto.find(p=>p.id===q.id);
    for(const hidden of ['answer','alternatives','conceptId','applied'])assert.equal(hidden in pub,false);
    const fresh=q.conceptId.endsWith('-fresh-0');
    const expected=fresh?freshReference(pub,grade):legacy.get(publicKey(pub));
    assert.notEqual(expected,undefined,`uncovered legacy ${q.text}`);
    assert.equal(answerMatches(q,expected),true,`${q.conceptId}: ${q.text}; expected ${expected}`);
    assert.equal(answerMatches(q,q.format==='number'?String(Number(expected)+1):'не знаю'),false);
    answers[q.id]=expected;
    if(fresh){covered.add(q.skill+'-'+grade);assert.equal(q.format,'number');assert.equal(q.choices,undefined);assert.equal(q.applied,true);}
   }
   assert.equal(gradeAssessment({specialization:spec,questions},answers).passed,true);
  }
 }
 assert.equal(covered.size,24);
});

test('v4 confirmed evidence and active tests become stale on v5 upgrade',()=>{
 const state=freshState(),user=actor(state,'demo-candidate');
 user.assessmentVersion=4;user.evidenceSource='assessment';user.categoryConfirmed=true;user.fsp=true;user.grade='Senior';user.gradeChangedAt=123;
 user.skills=['Python'];user.attempts=[{id:'v4-success',passed:true,grade:'Senior',score:100,assessmentVersion:4}];
 state.tests.push({id:'v4-active',userId:user.id,assessmentVersion:4,createdAt:100,expiresAt:10000000000000,questions:[]});
 upgradeState(state);
 assert.equal(user.assessmentVersion,5);assert.equal(user.categoryConfirmed,false);assert.equal(user.evidenceSource,'legacy_retest_required');
 assert.deepEqual(user.skills,[]);assert.equal(user.grade,'Senior');assert.equal(user.gradeChangedAt,123);assert.equal(user.attempts.length,1);
 assert.equal(user.attempts[0].assessmentVersion,4);assert.ok(state.tests.find(t=>t.id==='v4-active').invalidated);
});
