// Legacy pure reference model for unit comparison. Runtime APIs use real-accounts.mjs
// and accounts-repository.mjs; this module is not the production persistence path.
// Integration-ready core. Deliberately not wired to the public demo API until an
// identity/email provider and real-data policy are approved. Never use demo cookies here.
const requireValue=(value,message)=>{if(!value)throw new Error(message);};
const identityKey=principal=>{requireValue(principal?.issuer&&principal?.subject,'Verified server principal required');return JSON.stringify([principal.issuer,principal.subject]);};
export function enrollAccount(accounts, principal, input, now=Date.now()) {
  const key=identityKey(principal),existing=accounts.find(account=>account.identityKey===key);
  if(existing)return existing;
  requireValue(['candidate','employer'].includes(input.role),'Invalid role');
  const email=String(input.email||'').trim().toLowerCase();
  requireValue(email.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),'Invalid email');
  requireValue(!accounts.some(account=>account.email===email),'Email already registered');
  const account={id:crypto.randomUUID(),identityKey:key,role:input.role,email,emailVerified:false,createdAt:now};accounts.push(account);return account;
}
export function accountForPrincipal(accounts,principal){const account=accounts.find(item=>item.identityKey===identityKey(principal));requireValue(account,'Account not enrolled');return account;}
export function authorizeAccount(accounts,principal,role){const account=accountForPrincipal(accounts,principal);requireValue(account.emailVerified,'Email verification required');requireValue(account.role===role,'Role forbidden');return account;}
const digest=async token=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token)))).map(byte=>byte.toString(16).padStart(2,'0')).join('');
const tokenValue=()=>Array.from(crypto.getRandomValues(new Uint8Array(32))).map(byte=>byte.toString(16).padStart(2,'0')).join('');
export async function requestEmailVerification(account,challenges,{now=Date.now(),transport}={}) {
  requireValue(!account.emailVerified,'Email already verified');
  requireValue(transport&&typeof transport.deliverVerification==='function','Email provider is not configured');
  const previous=challenges.filter(item=>item.accountId===account.id);
  requireValue(!previous.some(item=>now-item.createdAt<60000),'Wait before resending');
  requireValue(previous.filter(item=>now-item.createdAt<3600000).length<5,'Hourly email limit reached');
  const token=tokenValue(),challenge={id:crypto.randomUUID(),accountId:account.id,email:account.email,tokenHash:await digest(token),createdAt:now,expiresAt:now+15*60000,failedAttempts:0,consumedAt:null,deliveryStatus:'pending'};
  // Production adapter must persist this pending record and an idempotent outbox
  // job atomically before attempting delivery; failures do not verify the account.
  challenges.push(challenge);
  try { await transport.deliverVerification({to:account.email,token,challengeId:challenge.id,expiresAt:challenge.expiresAt,idempotencyKey:challenge.id});challenge.deliveryStatus='sent'; }
  catch {challenge.deliveryStatus='failed';return {ok:false,error:'Email delivery failed',challengeId:challenge.id};}
  for(const old of previous)if(!old.consumedAt)old.consumedAt=now;
  return {ok:true,challengeId:challenge.id,expiresAt:challenge.expiresAt};
}
export async function verifyEmail(account,challenge,token,now=Date.now()) {
  if(!challenge||challenge.accountId!==account.id||challenge.email!==account.email||challenge.deliveryStatus!=='sent'||challenge.consumedAt!==null||now>=challenge.expiresAt||challenge.failedAttempts>=5)return {ok:false,error:'Verification unavailable'};
  const supplied=await digest(String(token||''));let difference=0;for(let index=0;index<supplied.length;index++)difference|=supplied.charCodeAt(index)^challenge.tokenHash.charCodeAt(index);
  if(difference){challenge.failedAttempts++;return {ok:false,error:'Invalid token'};}
  challenge.consumedAt=now;account.emailVerified=true;account.emailVerifiedAt=now;return {ok:true};
}
