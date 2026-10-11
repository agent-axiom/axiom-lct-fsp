// Public operator details are runtime configuration, never guessed from the
// project name, repository owner or federation branding.
const value=input=>typeof input==='string'?input.trim():'';
export function privacyConfiguration(env={}){
 const name=value(env.FSP_PRIVACY_OPERATOR_NAME),contact=value(env.FSP_PRIVACY_CONTACT_EMAIL);
 const operatorName=name&&name.length<=300?name:null;
 const contactEmail=contact.length<=254&&/^[A-Za-z0-9._%+-]+@(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/.test(contact)?contact:null;
 return {operatorName,contactEmail,ready:!!operatorName&&!!contactEmail,
  publicRegistrationEnabled:env.FSP_REAL_ACCOUNTS_ENABLED==='true'&&env.FSP_EMAIL_AUTH_ENABLED==='true',
  noticeVersion:value(env.FSP_PRIVACY_NOTICE_VERSION)||null};
}
