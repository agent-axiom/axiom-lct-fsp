import {test} from 'node:test';
import assert from 'node:assert/strict';
import {freshState,actor} from '../lib/domain.mjs';
import {parseRequirements,matchCandidate} from '../lib/matching.mjs';

const candidate=()=>({...actor(freshState(),'candidate-6'),score:100});

test('unmarked unsupported technology and alias require manual review without fabricated skills',()=>{
 for(const technology of ['Rust','Elixir','C#','csharp']) {
  const person=candidate(),before=structuredClone(person);
  const need=`Middle Backend ${technology}`;
  const requirements=parseRequirements({need});
  const row=matchCandidate(person,requirements);
  assert.deepEqual(requirements.unverifiedRequirements,[need],technology);
  assert.equal(row.matchStatus,'unverified',technology);
  assert.ok(row.match<100,technology);
  assert.equal(row.achievement.bonus,0,technology);
  assert.ok(row.missing.some(item=>item.includes(technology)),technology);
  assert.ok(row.reasons.some(item=>item.includes('Нужна ручная проверка')),technology);
  assert.deepEqual(person,before,technology);
  assert.ok(!requirements.skills.some(skill=>['Rust','Elixir','C#','csharp'].includes(skill)),technology);
 }
});

test('optional and negated unsupported technologies remain neutral while known skills still apply',()=>{
 const person=candidate();
 const neutralClauses=['optional Rust','Rust optional','Rust not needed','Rust not required','Rust is not required','Rust не обязателен','не требуется Elixir','без Elixir','Elixir необязателен','C# не нужен','csharp будет плюсом'];
 const baseline=matchCandidate(person,parseRequirements({need:'Middle Backend Python SQL'}));
 for(const clause of neutralClauses) {
  const requirements=parseRequirements({need:`Middle Backend Python SQL; ${clause}`});
  const row=matchCandidate(person,requirements);
  assert.deepEqual(requirements.unverifiedRequirements,[],clause);
  assert.equal(row.match,baseline.match,clause);
  assert.equal(row.matchStatus,baseline.matchStatus,clause);
  assert.equal(row.achievement.bonus,baseline.achievement.bonus,clause);
  const lacksSql={...person,skills:person.skills.filter(skill=>skill!=='SQL')};
  const partial=matchCandidate(lacksSql,requirements);
  assert.ok(partial.missing.includes('SQL'),clause);
  assert.ok(partial.match<row.match,clause);
 }
});

test('mixed alternatives with unsupported technology stay unverified and independent positive clauses survive',()=>{
 const person=candidate();
 for(const need of ['Middle Backend Python или Rust','Middle Backend Rust or Elixir','Middle Backend C# или Python']) {
  const requirements=parseRequirements({need});
  const row=matchCandidate(person,requirements);
  assert.deepEqual(requirements.unverifiedRequirements,[need],need);
  assert.equal(row.matchStatus,'unverified',need);
  assert.ok(row.match<100,need);
  assert.equal(row.achievement.bonus,0,need);
 }
 const need='Middle Backend; optional Rust, Elixir';
 const requirements=parseRequirements({need});
 assert.deepEqual(requirements.unverifiedRequirements,['Elixir']);
 assert.equal(matchCandidate(person,requirements).matchStatus,'unverified');
 const mandatory=parseRequirements({need:'Middle Backend; обязателен Rust'});
 assert.deepEqual(mandatory.unverifiedRequirements,['обязателен Rust']);
});

test('an optional or negative neighbor cannot hide a positive unsupported requirement',()=>{
 const person=candidate();
 for(const clause of ['Rust и желательно Elixir','Rust and optional csharp','C# и без Elixir']) {
  const requirements=parseRequirements({need:`Middle Backend; ${clause}`});
  assert.deepEqual(requirements.unverifiedRequirements,[clause],clause);
  const row=matchCandidate(person,requirements);
  assert.equal(row.matchStatus,'unverified',clause);
  assert.equal(row.achievement.bonus,0,clause);
  assert.ok(row.match<100,clause);
 }
 for(const clause of ['optional Rust и Elixir','без Rust и C#','not required Rust or csharp']) {
  const requirements=parseRequirements({need:`Middle Backend Python SQL; ${clause}`});
  assert.deepEqual(requirements.unverifiedRequirements,[],clause);
  assert.equal(matchCandidate(person,requirements).match,100,clause);
 }
});
