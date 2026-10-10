import {env} from 'cloudflare:workers';
import {notFound} from 'next/navigation';
import {requireChatGPTUser} from '@/app/chatgpt-auth';
import {isOwnerEmailTestUser, ownerEmailTestConfiguration} from '@/lib/owner-email-test.mjs';
import OwnerDomainEmailTest from './test-panel';
export const dynamic = 'force-dynamic';
export default async function OwnerDomainEmailTestPage() {
  const user = await requireChatGPTUser('/owner/domain-email-test');
  if (!isOwnerEmailTestUser(user, ownerEmailTestConfiguration(env))) notFound();
  return <OwnerDomainEmailTest/>;
}
