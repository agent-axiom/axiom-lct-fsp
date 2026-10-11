import {env} from 'cloudflare:workers';
import {publicEmailAuthConfiguration} from '@/lib/public-email-auth.mjs';
import AccountPortal from '../portal';
import {accountOrigin} from '../origin';
export const dynamic='force-dynamic';
export default function VerifyPage(){const config=publicEmailAuthConfiguration(env);return <AccountPortal verification canonicalOrigin={accountOrigin(config.siteOrigin)}/>;}
