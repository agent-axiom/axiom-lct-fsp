// Run with node --import tsx. Actual React server rendering, not browser E2E.
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import assert from 'node:assert/strict';
import {AssessmentProof} from '../components/assessment-proof.tsx';
import {DemoScenario} from '../components/demo-scenario.tsx';
import {ASSESSMENT_VERSION} from '../lib/assessment.mjs';
import {freshState,actor,command,view} from '../lib/domain.mjs';
const s=freshState(),now=Date.UTC(2026,9,5,15),u=actor(s,'demo-candidate');
const seed=renderToStaticMarkup(React.createElement(AssessmentProof,{evidence:view(s,u).user.evidence}));
assert.match(seed,/Демо-данные/);assert.match(seed,/даты прохождения/);assert.ok(!seed.includes(`банк v${ASSESSMENT_VERSION}`)&&!seed.includes('3/3'));
const {test}=command(s,u.id,{action:'test-start',specialization:'Backend',grade:'Middle'},now),stored=s.tests.find(t=>t.id===test.id);
command(s,u.id,{action:'test-submit',testId:test.id,answers:Object.fromEntries(stored.questions.map(q=>[q.id,q.answer]))},now+1);
const proof=renderToStaticMarkup(React.createElement(AssessmentProof,{evidence:view(s,u).user.evidence,requiredSkills:['SQL']}));
for(const text of ['12 из 12 заданий',`банк v${ASSESSMENT_VERSION}`,'UTC','Python','SQL','HTTP','Algorithms','Прикладные: 2/2','знания: 1/1','В запросе'])assert.ok(proof.includes(text),text);
assert.equal((proof.match(/Задания и результаты/g)||[]).length,4);assert.equal((proof.match(/Задание \d+/g)||[]).length,12);assert.ok(proof.includes('Верно'));assert.ok(proof.startsWith('<details'));assert.ok(proof.includes('<summary>'));assert.ok(!proof.includes(u.email));assert.ok(!proof.includes('conceptId')&&!proof.includes('answer'));
const scenario=renderToStaticMarkup(React.createElement(DemoScenario,{candidate:false,busy:true,onCandidateTest:()=>{},onEmployer:()=>{},onCandidateInvitations:()=>{}}));
assert.match(scenario,/<details[^>]*open/);assert.match(scenario,/Путь демонстрации/);assert.match(scenario,/Сейчас: работодатель/);assert.match(scenario,/не подтверждает вход двух реальных пользователей/);assert.equal((scenario.match(/<button/g)||[]).length,3);assert.equal((scenario.match(/disabled=""/g)||[]).length,3);
console.log(JSON.stringify({passed:true,scope:'React SSR of current/synthetic evidence and two-role guide; no browser or live authentication claim',skillRows:4,disabledScenarioButtons:3}));
