// A cache partition only, never a credential. The input comes exclusively from
// the trusted platform principal or resolved HttpOnly guest session.
export async function assessmentDraftIdentity(mode, identity) {
  const bytes = new TextEncoder().encode(JSON.stringify(['fsp-assessment-draft-v1', mode, identity]));
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
}
