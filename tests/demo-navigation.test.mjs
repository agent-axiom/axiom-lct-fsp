import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDemoNavigation,DEMO_NAVIGATION_KEY,DEMO_SEARCH_EXAMPLES,confirmDraftNavigation} from '../lib/demo-navigation.mjs';
import {freshState,actor,rankCandidates} from '../lib/domain.mjs';
const memory=()=>{const values=new Map();return {getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};};
const data=(id='demo-employer',role='employer',identity='a')=>({draftIdentity:identity.repeat(64),user:{id,role}});
test('Demo shortcuts retain offered candidate and selected employer across refresh',()=>{
 const storage=memory(),nav=createDemoNavigation(()=>storage);nav.reconcile('/api/guest',data('custom-employer'));nav.select('candidate','candidate-2');
 const fresh=createDemoNavigation(()=>storage);assert.deepEqual(fresh.reconcile('/api/guest',data('custom-employer')),{candidate:'candidate-2',employer:'custom-employer'});
 assert.deepEqual(fresh.reconcile('/api/guest',data('candidate-2','candidate')),{candidate:'candidate-2',employer:'custom-employer'});
 assert.deepEqual(createDemoNavigation(()=>storage).reconcile('/api/guest',data('candidate-2','candidate')),{candidate:'candidate-2',employer:'custom-employer'});
});
test('Demo shortcut storage is partitioned by server identity and API mode; reset clears it',()=>{
 const storage=memory(),nav=createDemoNavigation(()=>storage);nav.reconcile('/api/guest',data());nav.select('candidate','candidate-2');
 assert.equal(nav.reconcile('/api/guest',data('demo-employer','employer','b')).candidate,'demo-candidate');
 nav.select('candidate','candidate-2');assert.equal(nav.reconcile('/api',data('demo-employer','employer','b')).candidate,'demo-candidate');
 nav.select('candidate','candidate-2');nav.clear();assert.equal(storage.getItem(DEMO_NAVIGATION_KEY),null);assert.equal(nav.reconcile('/api',data()).candidate,'demo-candidate');
});
test('Malformed, oversized or unavailable storage never blocks demo; account mode does not persist',()=>{
 for(const value of ['not json','x'.repeat(1001),JSON.stringify({binding:'/api/guest:'+'a'.repeat(64),roles:{candidate:'https://bad.test',employer:'demo-employer'}})]){
 const storage=memory();storage.setItem(DEMO_NAVIGATION_KEY,value);assert.equal(createDemoNavigation(()=>storage).reconcile('/api/guest',data()).candidate,'demo-candidate');}
 const nav=createDemoNavigation(()=>{throw Error('blocked');});nav.reconcile('/api/guest',data());assert.equal(nav.select('candidate','candidate-2').candidate,'candidate-2');nav.clear();
 for(const api of ['/api/account','/api/public-account']){
  const storage=memory(),nav=createDemoNavigation(()=>storage);nav.reconcile(api,data('private-account'));nav.select('candidate','other-private-account');assert.equal(storage.getItem(DEMO_NAVIGATION_KEY),null);
 }
});
test('Stored shortcuts include only partition and role IDs, never account/contact/test fields',()=>{
 const storage=memory();createDemoNavigation(()=>storage).reconcile('/api/guest',{...data(),email:'secret@example.test',test:{answers:'secret'}});
 assert.deepEqual(Object.keys(JSON.parse(storage.getItem(DEMO_NAVIGATION_KEY))).sort(),['binding','roles']);assert.ok(!storage.getItem(DEMO_NAVIGATION_KEY).includes('secret'));
});
test('Judge examples execute real matcher with honest synthetic evidence and a visible missing requirement',()=>{
 const state=freshState(),employer=actor(state,'demo-employer');
 const first=rankCandidates(state,employer,DEMO_SEARCH_EXAMPLES[0].filters);assert.ok(first.some(c=>c.id==='demo-candidate'));assert.ok(first.every(c=>c.specialization==='Backend'&&c.grade==='Middle'));
 const second=rankCandidates(state,employer,DEMO_SEARCH_EXAMPLES[1].filters);assert.ok(second.length>0);assert.ok(second.every(c=>c.specialization==='Frontend'&&c.grade==='Middle'));
 const gap=rankCandidates(state,employer,DEMO_SEARCH_EXAMPLES[2].filters);assert.ok(gap.length>0);assert.ok(gap.every(c=>c.missing.includes('Kubernetes')));
 for(const c of [...first,...second,...gap]){assert.equal(c.evidence.status,'synthetic');assert.equal(c.evidence.completedAt,null);assert.ok(!c.contact&&!c.email);}
});

test('Dirty test navigation requires confirmation; cancel preserves caller state and ordinary actions never prompt',()=>{
 const answers={q1:'Python',q2:''};let prompts=0;const cancel=message=>{prompts++;assert.match(message,/ответы будут удалены/);return false;};
 assert.equal(confirmDraftNavigation('switch',true,answers,cancel),false);assert.equal(confirmDraftNavigation('register',true,answers,cancel),false);assert.deepEqual(answers,{q1:'Python',q2:''});
 for(const [action,active,values]of [['switch',false,answers],['switch',true,{q1:'  '}],['search',true,answers],['test-submit',true,answers],['profile',true,answers]])assert.equal(confirmDraftNavigation(action,active,values,cancel),true);
 assert.equal(prompts,2);assert.equal(confirmDraftNavigation('switch',true,answers,()=>true),true);
});
