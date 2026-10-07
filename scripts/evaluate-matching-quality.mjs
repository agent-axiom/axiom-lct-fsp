#!/usr/bin/env node
// Independent evaluation wrapper. Never changes the benchmark or implementation.
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const here=resolve(dirname(fileURLToPath(import.meta.url)),'../tests/fixtures/matching-quality');
const argv=process.argv.slice(2);
const arg=(name,fallback=null)=>{const i=argv.indexOf(name);if(i<0)return fallback;if(!argv[i+1]||argv[i+1].startsWith('--'))throw new Error(`Missing value for ${name}`);return argv[i+1];};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const dcg=values=>values.reduce((sum,value,index)=>sum+(2**value-1)/Math.log2(index+2),0);
export function metrics(rows,query){
  const top=rows.slice(0,5), labels=top.map(row=>query.relevance[row.id]??0);
  const ideal=Object.values(query.relevance).sort((a,b)=>b-a).slice(0,5),idcg=dcg(ideal);
  return {precisionAt5:labels.filter(v=>v>=2).length/5,legacyPrecisionAt5:labels.filter(v=>v>0).length/5,ndcgAt5:idcg>0?dcg(labels)/idcg:null,precisionAt5Ceiling:Math.min(5,Object.values(query.relevance).filter(v=>v>=2).length)/5,returnedCount:rows.length,top:top.map(row=>({id:row.id,score:row.match??null,label:query.relevance[row.id]??0}))};
}
function aggregate(cases){
  const valid=cases.filter(x=>x.ndcgAt5!==null),mean=(arr,key)=>arr.length?arr.reduce((s,x)=>s+x[key],0)/arr.length:null;
  return {queries:cases.length,precisionAt5:mean(cases,'precisionAt5'),legacyPrecisionAt5:mean(cases,'legacyPrecisionAt5'),ndcgAt5:mean(valid,'ndcgAt5'),ndcgDenominator:valid.length,zeroIdealQueries:cases.filter(x=>x.ndcgAt5===null).map(x=>x.id),meanPrecisionAt5Ceiling:mean(cases,'precisionAt5Ceiling')};
}
function selfTest(){
  const q={relevance:{a:3,b:2,c:1,d:0,e:0,f:2}};
  const x=metrics([{id:'a'},{id:'b'},{id:'c'},{id:'d'},{id:'e'}],q);
  assert.equal(x.precisionAt5,.4);assert.equal(x.legacyPrecisionAt5,.6);
  assert.equal(metrics([{id:'a'},{id:'b'},{id:'f'},{id:'c'},{id:'d'}],q).ndcgAt5,1);
  assert.equal(metrics([{id:'a'}],q).precisionAt5,.2);
  assert.equal(metrics([{id:'a'}],{relevance:{a:0}}).ndcgAt5,null);
  assert.equal(metrics([],{relevance:{a:3}}).ndcgAt5,0);
  assert.equal(aggregate([{id:'empty',precisionAt5:0,legacyPrecisionAt5:0,ndcgAt5:null,precisionAt5Ceiling:0}]).ndcgDenominator,0);
  console.log('PASS: hand-computed metric tests (no FSP matcher loaded).');
}
if(argv.includes('--self-test')){selfTest();process.exit(0);}
const fixturePath=resolve(arg('--fixture',`${here}/matching-benchmark.frozen.json`));
const manifest=JSON.parse(readFileSync(`${here}/freeze-manifest.json`,'utf8'));
const fixtureBytes=readFileSync(fixturePath),fixtureHash=sha(fixtureBytes);
assert.equal(fixtureHash,manifest.files['matching-benchmark.frozen.json'],'Benchmark bytes differ from frozen manifest; do not silently relabel after evaluation.');
const fixture=JSON.parse(fixtureBytes);
assert.equal(fixture.candidates.length,36);assert.equal(fixture.queries.length,36);
const ids=new Set(fixture.candidates.map(c=>c.id));assert.equal(ids.size,36);
for(const q of fixture.queries){assert.equal(Object.keys(q.relevance).length,36);for(const [id,v] of Object.entries(q.relevance)){assert.ok(ids.has(id));assert.ok([0,1,2,3].includes(v));}}
if(argv.includes('--validate-only')){console.log(JSON.stringify({status:'valid',fixtureSha256:fixtureHash,...manifest.statistics},null,2));process.exit(0);}
const split=arg('--split','visible');
assert.ok(['train','development','visible','heldout','all'].includes(split),'Invalid --split.');
if(['heldout','all'].includes(split)&&!argv.includes('--acknowledge-heldout'))throw new Error('Heldout evaluation is an explicit final checkpoint: pass --acknowledge-heldout. Do not tune on its results.');
const modulePath=arg('--module'),matchingPath=arg('--matching-module');
if(Boolean(modulePath)===Boolean(matchingPath))throw new Error('Supply exactly one: --module /abs/lib/domain.mjs OR --matching-module /abs/lib/matching.mjs');
const implementationPath=resolve(modulePath||matchingPath),implementationBytes=readFileSync(implementationPath);
const implementation=await import(pathToFileURL(implementationPath).href);
const allowed=c=>['verified','published','consent','categoryConfirmed'].every(k=>c[k]===true);
let rank;
if(modulePath){
  for(const name of ['freshState','actor','rankCandidates'])assert.equal(typeof implementation[name],'function',`Missing domain export ${name}`);
  const state=implementation.freshState();
  const employer=state.users.find(u=>u.id==='demo-employer')||state.users.find(u=>u.role==='employer');
  assert.ok(employer,'Domain must provide a demonstration employer.');
  state.users=[employer,...structuredClone(fixture.candidates)];
  rank=query=>implementation.rankCandidates(state,implementation.actor(state,employer.id),query);
}else{
  for(const name of ['parseRequirements','matchCandidate'])assert.equal(typeof implementation[name],'function',`Missing matcher export ${name}`);
  rank=query=>{
    const req=implementation.parseRequirements(query);
    return fixture.candidates.filter(allowed)
      .filter(c=>(!query.specialization||c.specialization===query.specialization)&&(!query.grade||c.grade===query.grade)&&(!query.fsp||c.fsp)&&(req.explicitSkills||[]).every(s=>c.skills.some(v=>v.toLowerCase()===s.toLowerCase())))
      .map(c=>({...c,...implementation.matchCandidate(c,req)})).sort((a,b)=>b.match-a.match||a.id.localeCompare(b.id));
  };
}
const selected=fixture.queries.filter(q=>split==='all'||split==='visible'&&q.split!=='heldout'||q.split===split);
const candidates=new Map(fixture.candidates.map(c=>[c.id,c]));
const cases=[];
for(const q of selected){
  const rows=await rank(q);assert.ok(Array.isArray(rows),'Ranking interface must return an array.');
  const rowids=rows.map(x=>x.id);assert.equal(new Set(rowids).size,rowids.length,'Duplicate candidate IDs inflate quality metrics.');
  for(const id of rowids)assert.ok(ids.has(id),`Unknown candidate returned: ${id}`);
  for(const row of rows)assert.ok(Number.isFinite(row.match),`Non-finite match score: ${row.id}`);
  const safetyViolations=rows.filter(row=>!allowed(candidates.get(row.id))).map(row=>row.id);
  const requirements=typeof implementation.parseRequirements==='function'?implementation.parseRequirements(q):null;
  cases.push({id:q.id,split:q.split,need:q.need,tags:q.tags,...metrics(rows,q),safetyViolations,parserWarnings:requirements?.warnings??null,parserExpectations:q.parserExpectations});
}
const result={dataset:fixture.name,fixtureSha256:fixtureHash,frozenAt:manifest.frozenAt,evaluatedAt:new Date().toISOString(),label:arg('--label','unnamed'),mode:modulePath?'domain-rankCandidates':'matchCandidate-with-domain-equivalent-prefilters',implementationPath,implementationSha256:sha(implementationBytes),split,disclaimer:fixture.disclaimer,metricDefinitions:fixture.metricDefinitions,overall:aggregate(cases),bySplit:Object.fromEntries(['train','development','heldout'].map(s=>[s,aggregate(cases.filter(c=>c.split===s))])),byTag:Object.fromEntries([...new Set(cases.flatMap(c=>c.tags))].sort().map(tag=>[tag,aggregate(cases.filter(c=>c.tags.includes(tag)))])),safetyViolationCount:cases.reduce((n,c)=>n+c.safetyViolations.length,0),cases};
const out=JSON.stringify(result,null,2)+'\n';
const write=arg('--write');if(write)writeFileSync(resolve(write),out);
console.log(out);
