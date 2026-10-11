import {test} from 'node:test';
import assert from 'node:assert/strict';
import {privacyConfiguration} from '../lib/privacy-configuration.mjs';

test('privacy readiness never invents operator details from account activation or project identity',()=>{
 const config=privacyConfiguration({FSP_REAL_ACCOUNTS_ENABLED:'true',FSP_EMAIL_AUTH_ENABLED:'true'});
 assert.equal(config.ready,false);assert.equal(config.operatorName,null);assert.equal(config.contactEmail,null);
 assert.equal(config.publicRegistrationEnabled,true);
});
test('a missing or malformed contact keeps privacy readiness closed',()=>{
 for(const contact of [undefined,'','invalid','operator@example.test\nBcc:other@example.test','mailto:operator@example.test','operator@example.test?subject=unexpected']){
  const config=privacyConfiguration({FSP_PRIVACY_OPERATOR_NAME:'Synthetic Operator',FSP_PRIVACY_CONTACT_EMAIL:contact});
  assert.equal(config.ready,false,JSON.stringify(contact));assert.equal(config.contactEmail,null);
 }
 assert.equal(privacyConfiguration({FSP_PRIVACY_CONTACT_EMAIL:'operator@example.test'}).ready,false);
});
test('real configured details make the policy ready without activating public registrations',()=>{
 const config=privacyConfiguration({FSP_PRIVACY_OPERATOR_NAME:' Synthetic Operator ',FSP_PRIVACY_CONTACT_EMAIL:' operator@example.test ',FSP_PRIVACY_NOTICE_VERSION:' test-v1 '});
 assert.equal(config.ready,true);assert.equal(config.operatorName,'Synthetic Operator');assert.equal(config.contactEmail,'operator@example.test');assert.equal(config.noticeVersion,'test-v1');assert.equal(config.publicRegistrationEnabled,false);
});
