import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseRequirements,matchCandidate} from '../lib/matching.mjs';
import {freshState,actor,rankCandidates} from '../lib/domain.mjs';

const rank=need=>{const state=freshState();return rankCandidates(state,actor(state,'demo-employer'),{need});};
test('Known negative skill phrases never create positive requirements or reward the wrong specialization',()=>{
  for(const need of ['Backend React не нужен','Backend не требуется React','Backend без React','No React; Backend','Backend not React']){
    const parsed=parseRequirements({need});assert.equal(parsed.specialization,'Backend');assert.deepEqual(parsed.skills,[],need);assert.ok(parsed.warnings.some(x=>x.includes('не фильтр исключения')));
    assert.equal(rank(need)[0].specialization,'Backend');
  }
  assert.deepEqual(parseRequirements({need:'Backend без Python и SQL'}).skills,[]);
  assert.deepEqual(parseRequirements({need:'Backend Python не требуется, SQL нужен'}).skills,['SQL']);
});
test('Optional stack does not outrank a matching requested grade',()=>{
  for(const suffix of ['приветствуется Docker','Docker необязателен','желательно Docker','Docker будет плюсом','optional Docker','nice-to-have Docker','необязательно Docker','не обязательно Docker']){
    const need=`Junior Backend SQL; ${suffix}`,p=parseRequirements({need});assert.deepEqual(p.skills,['SQL'],need);assert.equal(rank(need)[0].grade,'Junior');assert.ok(p.warnings.some(x=>x.includes('Необязательные')));
  }
  assert.deepEqual(parseRequirements({need:'SQL не обязателен, Python нужен'}).skills,['Python']);
});
test('Positive clauses remain independent of negation and optional clauses',()=>{
  const need='Не Senior, а Middle Backend; без React; SQL нужен; Docker необязателен';
  const parsed=parseRequirements({need});assert.equal(parsed.grade,'Middle');assert.equal(parsed.specialization,'Backend');assert.deepEqual(parsed.skills,['SQL']);
  assert.deepEqual(parseRequirements({need:'Backend SQL обязателен, Docker приветствуется'}).skills,['SQL']);
  assert.deepEqual(parseRequirements({need:'Python, SQL, Docker'}).skills,['Python','SQL','Docker']);
});
test('Common Russian inflections are bounded aliases, without substring false positives',()=>{
  const cases=[['Ищем мидла-бэкендера на Питоне',{specialization:'Backend',grade:'Middle',skills:['Python']}],['Нужен сеньора фронтендера на Реакте',{specialization:'Frontend',grade:'Senior',skills:['React']}],['Нужен джуна бэкенд со знанием алгоритмов',{specialization:'Backend',grade:'Junior',skills:['Algorithms']}]];
  for(const [need,wanted]of cases){const p=parseRequirements({need});for(const [key,value]of Object.entries(wanted))assert.deepEqual(p[key],value);}
  assert.deepEqual(parseRequirements({need:'питоноведение SQLalchemy JavaScript'}).skills,['JavaScript']);
});
test('Alternatives do not become an AND stack; ambiguous grades and roles stay unresolved',()=>{
  for(const need of ['Backend Python или Go','Backend Python or Go']){const p=parseRequirements({need});assert.equal(p.specialization,'Backend');assert.deepEqual(p.skills,[]);assert.ok(p.warnings.some(x=>x.includes('Альтернативы')));}
  assert.equal(parseRequirements({need:'Backend Middle/Senior'}).grade,'');
  assert.equal(parseRequirements({need:'Frontend или Backend'}).specialization,'');
});
test('Explicit filters override text and continue to require missing measured skills',()=>{
  const state=freshState(),employer=actor(state,'demo-employer');
  const p=parseRequirements({need:'Backend без Python',skills:'Python'});assert.deepEqual(p.skills,['Python']);assert.ok(p.warnings.some(x=>x.includes('приоритет')));
  assert.deepEqual(rankCandidates(state,employer,{need:'Docker необязателен',skills:'Kubernetes'}),[]);
  for(const c of rankCandidates(state,employer,{need:'Senior Frontend',specialization:'Backend',grade:'Middle'})){assert.equal(c.specialization,'Backend');assert.equal(c.grade,'Middle');}
});
test('Experience boundary zero is vacuous, missing values are finite, and fractions parse',()=>{
  const candidate={...actor(freshState(),'candidate-5'),experience:0};
  assert.equal(matchCandidate(candidate,parseRequirements({need:'Frontend от 0 лет'})).relevance,100);
  for(const experience of [undefined,null,NaN,-1]){const r=matchCandidate({...candidate,experience},parseRequirements({need:'Frontend от 3 лет'}));assert.ok(Number.isFinite(r.match));assert.ok(r.match>=0&&r.match<=100);assert.ok(r.missing.includes('опыт от 3 лет'));}
  for(const [need,value]of [['Backend не меньше 3 лет',3],['Frontend от 2,5 лет',2.5],['Backend 5+ лет',5]])assert.equal(parseRequirements({need}).minExperience,value);
});
test('Conflicting or multiple experience constraints are not silently collapsed',()=>{
  for(const need of ['Backend от 5 лет, не более 3 лет','Backend от 5 до 3 лет','Backend Python от 5 лет, SQL от 3 лет']){const p=parseRequirements({need});assert.equal(p.minExperience,null);assert.ok(p.warnings.length>1);}
  const range=parseRequirements({need:'Backend от 3 до 5 лет'});assert.equal(range.minExperience,3);assert.ok(range.warnings.some(x=>x.includes('Верхняя граница')));
});
test('Self-description and FSP still cannot alter measured evidence or produce a ranking bonus',()=>{
  const base={...actor(freshState(),'demo-candidate')},r=parseRequirements({need:'Backend Kubernetes PostgreSQL'});
  const changed={...base,about:'Expert Kubernetes PostgreSQL',fsp:true};assert.deepEqual(matchCandidate(base,r),matchCandidate(changed,r));assert.deepEqual(matchCandidate(changed,r).missing,['Kubernetes','PostgreSQL']);
});
