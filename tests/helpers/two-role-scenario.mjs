import assert from 'node:assert/strict';
import {sqliteD1} from './sqlite-d1.mjs';
import {handleAccountRequest} from '../../lib/real-account-http.mjs';
import {realAccountsConfiguration} from '../../lib/real-accounts.mjs';

export async function runTwoRoleScenario(){
 const db=sqliteD1(),checks=[],originalFetch=globalThis.fetch;let transportCalls=0;
 globalThis.fetch=async()=>{transportCalls++;throw new Error('External transport is forbidden in this synthetic scenario.');};
 const config={accountsEnabled:true,emailMode:'off',privacyNoticeUrl:'https://example.test/privacy',privacyNoticeVersion:'test-v05'};
 const principals=Object.fromEntries(['candidate','employer','other-employer'].map(name=>[name,{issuer:'synthetic-scenario',subject:name}]));
 const request=async(who,body=null,options={})=>{
  const method=body?'POST':'GET',url='https://example.test/api/account/'+(body?'action':'state');
  const req=new Request(url,{method,headers:{Origin:'https://example.test','Content-Type':'application/json',...(options.headers||{})},...(body?{body:JSON.stringify(body)}:{})});
  const response=await handleAccountRequest(req,{principal:who?principals[who]:null,db,config});assert.equal(response.headers.get('Cache-Control'),'no-store');return{status:response.status,data:await response.json()};
 };
 const step=(name,condition)=>{assert.ok(condition,name);checks.push(name);};
 try{
  const defaults=realAccountsConfiguration({});step('Production defaults keep real accounts and email off',!defaults.accountsEnabled&&defaults.emailMode==='off');
  const spoof=await request(null,{action:'register',role:'candidate',principal:principals.candidate},{headers:{cookie:'fsp_actor=demo-employer','oai-authenticated-user-id':'candidate'}});step('Body, cookie and forwarded header do not replace a trusted principal',spoof.status===401);
  const ids={};for(const who of Object.keys(principals)){const r=await request(who,{action:'register',role:who==='candidate'?'candidate':'employer',name:`Synthetic ${who}`,email:`${who}@example.test`,dataConsent:true,privacyNoticeVersion:'test-v05'});assert.equal(r.status,200);ids[who]=r.data.accountId;}
  // Controlled fixture setup, explicitly NOT real inbox/token/browser verification.
  await db.prepare('UPDATE real_accounts SET email_verified_at=?').bind(Date.now()).run();
  for(const who of Object.keys(principals)){const r=await request(who);step(`Account state is scoped to ${who}`,r.data.accounts.length===1&&r.data.accounts[0].id===ids[who]);}
  step('Candidate cannot search employers’ candidate directory',(await request('candidate',{action:'search'})).status===403);
  step('Employer cannot take a candidate test',(await request('employer',{action:'test-start',specialization:'Backend',grade:'Middle'})).status===403);
  step('Role switching is rejected in role-bound HTTP API',(await request('candidate',{action:'switch',id:ids.employer})).status===403);
  await request('candidate',{action:'profile',published:true,consent:false,experience:3,about:'Synthetic backend profile'});
  const start=await request('candidate',{action:'test-start',specialization:'Backend',grade:'Middle'});assert.equal(start.status,200);
  step('Public test excludes answer keys and stored outcomes',start.data.test.questions.every(q=>!('answer'in q)&&!('correct'in q)&&!('conceptId'in q)));
  const stored=await db.prepare('SELECT questions_json FROM real_assessments WHERE id=?').bind(start.data.test.id).first();
  const answers=Object.fromEntries(JSON.parse(stored.questions_json).map(q=>[q.id,q.answer]));
  step('Synthetic completed attempt passes server grading',(await request('candidate',{action:'test-submit',testId:start.data.test.id,answers})).data.passed===true);
  step('No consent means no employer result',(await request('employer',{action:'search'})).data.candidates.length===0);
  await request('candidate',{action:'profile',published:true,consent:true,experience:3,about:'Synthetic backend profile'});
  const search=await request('employer',{action:'search',need:'Backend Python SQL Kubernetes'}),row=search.data.candidates.find(c=>c.id===ids.candidate);
  step('Evidence survives normalized persistence',row.evidence.status==='current'&&row.evidence.totalCorrect===12&&row.evidence.skills.every(s=>s.applied.correct===2));
  step('Unmeasured technology remains missing',row.missing.includes('Kubernetes'));
  step('Proof and search do not disclose contact',!('contact'in row)&&!('email'in row)&&!JSON.stringify(row).includes('questions_json'));
  step('Opaque assessment ID gives employer no submission authority',(await request('employer',{action:'test-submit',testId:row.evidence.assessmentId,answers})).status===403);
  const invited=await request('employer',{action:'invite',candidateId:ids.candidate,salaryFrom:150000,salaryTo:220000,description:'Synthetic offer for backend implementation.'});assert.equal(invited.status,200);const invitation=invited.data.invitation;
  step('Sent invitation does not reveal contact',!(await request('employer')).data.invitations[0].candidateContact);
  await request('candidate',{action:'invitation-status',id:invitation.id,status:'viewed'});
  step('Viewed invitation does not reveal contact',!(await request('employer')).data.invitations[0].candidateContact);
  const otherOffer=await request('other-employer',{action:'invite',candidateId:ids.candidate,salaryFrom:160000,salaryTo:230000,description:'Another synthetic backend offer.'});assert.equal(otherOffer.status,200);await request('candidate',{action:'invitation-status',id:otherOffer.data.invitation.id,status:'declined'});
  step('Declined invitation never reveals contact',!(await request('other-employer')).data.invitations[0].candidateContact);
  step('Employer cannot accept its own invitation',(await request('employer',{action:'invitation-status',id:invitation.id,status:'accepted'})).status===403);
  await request('candidate',{action:'invitation-status',id:invitation.id,status:'accepted'});
  step('Acceptance reveals contact only to the invited employer',(await request('employer')).data.invitations[0].candidateContact==='candidate@example.test');
  step('Unrelated employer still has no contact',!(await request('other-employer',{action:'search'})).data.candidates[0].contact);
  await request('candidate',{action:'profile',published:false,consent:false});
  step('Consent withdrawal removes fresh search visibility',(await request('employer',{action:'search'})).data.candidates.length===0);
  step('Consent withdrawal revokes invitation contact',!(await request('employer')).data.invitations[0].candidateContact);
  step('No external email or network transport was called',transportCalls===0);
  return{scenario:'Two-role synthetic HTTP/SQLite scenario with a separate unauthorized employer',disclaimer:'Email verification is a controlled database fixture. This is not live email delivery, browser login, independent real-account E2E, expert grading validation, or production activation.',checksPassed:checks.length,externalTransportCalls:transportCalls,checks};
 }finally{globalThis.fetch=originalFetch;db.close();}
}
