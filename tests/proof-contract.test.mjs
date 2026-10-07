import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {freshState,actor,command,rankCandidates} from '../lib/domain.mjs';

test('Evidence payload and nested skill rows match the closed OpenAPI allowlists',()=>{
 const s=freshState(),{test:t}=command(s,'demo-candidate',{action:'test-start',specialization:'Backend',grade:'Middle'}),stored=s.tests.find(x=>x.id===t.id);
 command(s,'demo-candidate',{action:'test-submit',testId:t.id,answers:Object.fromEntries(stored.questions.map(q=>[q.id,q.answer]))});
 const e=rankCandidates(s,actor(s,'demo-employer'),{}).find(x=>x.id==='demo-candidate').evidence,schemas=JSON.parse(readFileSync(new URL('../docs/openapi.json',import.meta.url),'utf8')).components.schemas;
 for(const [value,schema]of [[e,schemas.AssessmentEvidence],...[...e.skills].map(row=>[row,schemas.EvidenceSkill]),...e.skills.flatMap(row=>row.tasks||[]).map(task=>[task,schemas.EvidenceTask])]){assert.equal(schema.additionalProperties,false);assert.deepEqual(Object.keys(value).sort(),Object.keys(schema.properties).sort());}
 assert.equal(schemas.Competency.additionalProperties,false);
});
test('Actual React SSR renders measured versus synthetic proof and disabled scenario controls',()=>{
 const output=execFileSync(process.execPath,['--import','tsx','scripts/verify-proof-render.mjs'],{cwd:new URL('..',import.meta.url),encoding:'utf8'});assert.equal(JSON.parse(output).passed,true);
});
test('Demo role shortcuts retain the selected candidate and employer rather than hard-coding each return',()=>{
 const ui=readFileSync(new URL('../app/workspace.tsx',import.meta.url),'utf8');
 assert.ok(ui.includes('switchActor(scenarioCandidateId)'));assert.ok(ui.includes('switchActor(scenarioEmployerId)'));assert.ok(ui.includes('setScenarioCandidateId(c.id)'));assert.ok(ui.includes('!real&&<DemoScenario'));assert.ok(ui.indexOf('if(data?.user.id===id)return true;')<ui.indexOf("const d=await act({action:'switch'"));
});
