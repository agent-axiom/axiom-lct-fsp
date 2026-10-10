import {env} from 'cloudflare:workers';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {ownerEmailTestConfiguration} from '@/lib/owner-email-test.mjs';
import {handleOwnerDomainEmailTest} from '@/lib/owner-domain-email-test.mjs';
export const dynamic = 'force-dynamic';
async function handle(request: Request) {
  return handleOwnerDomainEmailTest(request, {user: await getChatGPTUser(), db: env.DB, config: ownerEmailTestConfiguration(env)});
}
export const GET = handle;
export const POST = handle;
