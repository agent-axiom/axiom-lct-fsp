import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createAssessmentDraftStore,clearAssessmentDraft,ASSESSMENT_DRAFT_KEY,MAX_DRAFT_ANSWER_LENGTH} from '../lib/assessment-drafts.mjs';
import {assessmentDraftIdentity} from '../lib/assessment-draft-identity.mjs';
import {invitationContactLabel} from '../lib/invitation-contact.mjs';
import {restoreDialogFocus} from '../lib/dialog-focus.mjs';
import {freshState,actor,command,view} from '../lib/domain.mjs';
const now = Date.now();
function storage() {const values=new Map();return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};}
function data() {return {draftIdentity:'a'.repeat(64),user:{id:'demo-candidate',role:'candidate',verified:true},test:{id:'attempt-a',specialization:'Backend',grade:'Junior',expiresAt:now+1800000,questions:[{id:'number',text:'Synthetic arithmetic',skill:'SQL',format:'number'},{id:'choice',text:'Synthetic choice',skill:'Python',choices:['one','two']}]}};}
function prepare(target=storage()) {const store=createAssessmentDraftStore(()=>target),state=data();store.reconcile('/api/guest',state,now);store.update('number','17',now);store.update('choice','two',now);return {target,store,state};}

test('same tab + trusted identity + active attempt restores free text and choice without extending the deadline',()=>{
 const {target,state}=prepare(),restored=createAssessmentDraftStore(()=>target).reconcile('/api/guest',state,now+1000);
 assert.deepEqual(restored.answers,{number:'17',choice:'two'});assert.match(restored.message,/восстановлены/);assert.equal(state.test.expiresAt,now+1800000);
 assert.deepEqual(createAssessmentDraftStore(()=>storage()).reconcile('/api/guest',state,now).answers,{});
});
test('exact owner, session, actor, API mode, attempt and question contract must all match',()=>{
 for(const mutate of [d=>d.draftIdentity='b'.repeat(64),d=>d.user.id='candidate-2',d=>d.test.id='attempt-b',d=>d.test.expiresAt++,d=>d.test.grade='Senior',d=>d.test.questions[0].text='Changed',d=>d.test.questions[1].choices.reverse()]){
  const {target,state}=prepare();mutate(state);assert.deepEqual(createAssessmentDraftStore(()=>target).reconcile('/api/guest',state,now).answers,{});
 }
 const {target,state}=prepare();assert.deepEqual(createAssessmentDraftStore(()=>target).reconcile('/api/account',state,now).answers,{});
});
test('submission, role change, missing identity, logout, reset, test expiry and guest expiry purge the slot',()=>{
 for(const mutate of [d=>delete d.test,d=>d.user.role='employer',d=>d.user.verified=false,d=>delete d.draftIdentity,d=>d.test.expiresAt=now,d=>d.guest={expiresAt:now}]){
  const {target,store,state}=prepare();mutate(state);const result=store.reconcile('/api/guest',state,now);assert.deepEqual(result.answers,{});assert.equal(result.active,false);assert.equal(target.getItem(ASSESSMENT_DRAFT_KEY),null);
 }
 const {target,store,state}=prepare();assert.equal(store.clear(),true);assert.equal(target.getItem(ASSESSMENT_DRAFT_KEY),null);assert.deepEqual(store.reconcile('/api/guest',state,now).answers,{});
 const other=prepare();assert.deepEqual(other.store.update('number','18',other.state.test.expiresAt).answers,{});assert.equal(other.target.getItem(ASSESSMENT_DRAFT_KEY),null);
});
test('corrupt, oversized, unknown-key, non-string, invalid-choice and prototype-shaped storage is discarded',()=>{
 for(const corrupt of [()=>'not json',()=>'x'.repeat(64001),raw=>JSON.stringify({...raw,version:2}),raw=>JSON.stringify({...raw,answers:{foreign:'17'}}),raw=>JSON.stringify({...raw,answers:{number:{answer:'17'}}}),raw=>JSON.stringify({...raw,answers:{number:'x'.repeat(MAX_DRAFT_ANSWER_LENGTH+1)}}),raw=>JSON.stringify({...raw,answers:{choice:'not an option'}}),raw=>JSON.stringify({...raw,answers:JSON.parse('{"__proto__":"bad"}')}),raw=>JSON.stringify({...raw,answers:[]})]){
  const {target,state}=prepare();target.setItem(ASSESSMENT_DRAFT_KEY,corrupt(JSON.parse(target.getItem(ASSESSMENT_DRAFT_KEY))));assert.deepEqual(createAssessmentDraftStore(()=>target).reconcile('/api/guest',state,now).answers,{});
 }
 assert.equal({}.polluted,undefined);
});
test('storage getter/read/write failures preserve usable in-memory answers and show no false saved status',()=>{
 for(const target of [()=>{throw new Error('SecurityError');},()=>({getItem:()=>{throw new Error('blocked');},setItem:()=>{throw new Error('blocked');},removeItem:()=>{throw new Error('blocked');}})]){
  const store=createAssessmentDraftStore(target),state=data();assert.equal(store.reconcile('/api/guest',state,now).active,true);const current=store.update('number','17',now);assert.deepEqual(current.answers,{number:'17'});assert.match(current.message,/Не удалось сохранить/);assert.deepEqual(store.reconcile('/api/guest',state,now).answers,{number:'17'});assert.doesNotThrow(()=>store.clear());
 }
 const {target,store,state}=prepare();target.setItem=()=>{throw new Error('QuotaExceededError');};const current=store.update('number','18',now);assert.equal(current.answers.number,'18');assert.match(current.message,/Не удалось сохранить/);assert.equal(target.getItem(ASSESSMENT_DRAFT_KEY),null);assert.equal(createAssessmentDraftStore(()=>target).reconcile('/api/guest',state,now).answers.number,undefined);
});
test('removal failure falls back to a tombstone and does not touch unrelated session data',()=>{
 const target=storage();target.setItem('unrelated','keep');target.setItem(ASSESSMENT_DRAFT_KEY,'old');target.removeItem=()=>{throw new Error('remove denied');};assert.equal(clearAssessmentDraft(()=>target),true);assert.equal(target.getItem(ASSESSMENT_DRAFT_KEY),'');assert.equal(target.getItem('unrelated'),'keep');
});
test('refresh cannot overwrite newer in-memory answers and invalid edits cannot corrupt the draft',()=>{
 const {target,store,state}=prepare(),old=target.getItem(ASSESSMENT_DRAFT_KEY);store.update('number','18',now);target.setItem(ASSESSMENT_DRAFT_KEY,old);assert.equal(store.reconcile('/api/guest',state,now).answers.number,'18');assert.equal(store.update('foreign','no',now).answers.foreign,undefined);assert.equal(store.update('choice','foreign option',now).answers.choice,'two');assert.equal(store.update('number','x'.repeat(501),now).answers.number,'18');
});
test('serialization is allowlisted and never retains grader keys, account/contact fields or tokens',()=>{
 const state=data(),target=storage();Object.assign(state.user,{email:'private@example.test',contact:'private@example.test'});Object.assign(state.test,{grader:'PRIVATE_GRADER'});Object.assign(state.test.questions[0],{answer:'PRIVATE_ANSWER',alternatives:['PRIVATE_ALTERNATIVE'],correct:true,conceptId:'PRIVATE_CONCEPT'});const store=createAssessmentDraftStore(()=>target);store.reconcile('/api/guest',state,now);store.update('number','17',now);const raw=target.getItem(ASSESSMENT_DRAFT_KEY);assert.deepEqual(Object.keys(JSON.parse(raw)).sort(),['answers','scope','version']);for(const secret of ['PRIVATE_','private@example.test','alternatives','conceptId'])assert.equal(raw.includes(secret),false);
});
test('trusted identity partitions differ by mode and identity without returning underlying identifiers',async()=>{
 const a=await assessmentDraftIdentity('demo','owner-a');assert.match(a,/^[a-f0-9]{64}$/);assert.equal(a,await assessmentDraftIdentity('demo','owner-a'));assert.notEqual(a,await assessmentDraftIdentity('demo','owner-b'));assert.notEqual(a,await assessmentDraftIdentity('guest','owner-a'));assert.equal(a.includes('owner-a'),false);
});
test('accepted then withdrawn consent shows unavailable copy without exposing the contact or claiming it will open on acceptance',()=>{
 const s=freshState(),candidate=actor(s,'demo-candidate'),employer=actor(s,'demo-employer');const {invitation}=command(s,employer.id,{action:'invite',candidateId:candidate.id,salaryFrom:100,salaryTo:200,description:'Synthetic offer for consent regression.'});
 assert.match(invitationContactLabel(view(s,employer).invitations[0]),/после принятия/);command(s,candidate.id,{action:'invitation-status',id:invitation.id,status:'accepted'});assert.match(invitationContactLabel(view(s,employer).invitations[0]),/разрешил контакт/);command(s,candidate.id,{action:'profile',consent:false,published:false});const dto=view(s,employer).invitations[0];assert.equal(dto.candidateContact,undefined);const label=invitationContactLabel(dto);assert.match(label,/Контакт недоступен/);assert.equal(label.includes(candidate.contact),false);assert.equal(label.includes('после принятия'),false);assert.match(invitationContactLabel({status:'declined'}),/отклонено/);
});
test('dialog focus returns to the actual trigger, then a safe fallback if disconnected, hidden or disabled',()=>{
 const document={activeElement:null};const target=()=>({isConnected:true,matches:()=>false,closest:()=>null,getClientRects:()=>[{}],ownerDocument:document,focus(){document.activeElement=this;}});const trigger=target(),fallback=target();assert.equal(restoreDialogFocus([trigger,fallback]),true);assert.equal(document.activeElement,trigger);for(const key of ['disconnected','disabled','hidden','invisible']){const removed=target();if(key==='disconnected')removed.isConnected=false;if(key==='disabled')removed.matches=()=>true;if(key==='hidden')removed.closest=()=>({});if(key==='invisible')removed.getClientRects=()=>[];assert.equal(restoreDialogFocus([removed,fallback]),true);assert.equal(document.activeElement,fallback);}assert.equal(restoreDialogFocus([null]),false);
});
test('workspace integrates immediate draft updates, submission acknowledgement cleanup and dialog close restoration',()=>{
 const ui=readFileSync(new URL('../app/workspace.tsx',import.meta.url),'utf8');assert.ok(ui.includes('draftStore.reconcile(api,d)'));assert.ok(ui.includes('draftStore.update(id,value)'));assert.ok(ui.includes("['test-submit','reset-demo','switch','register'].includes(payload.action)"));assert.ok(ui.includes('onClick={()=>{discardDraft();demoNavigation.clear();}} href="/signout-with-chatgpt'));assert.ok(ui.includes('offerTrigger.current=event.currentTarget'));assert.ok(ui.includes('onCloseAutoFocus={event=>{event.preventDefault();restoreDialogFocus'));assert.ok(ui.includes('invitationContactLabel(i)'));
});
