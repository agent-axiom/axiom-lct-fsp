import {env} from 'cloudflare:workers';
import {handlePublicAccountRequest} from '@/lib/public-account-http.mjs';
import {publicEmailAuthConfiguration} from '@/lib/public-email-auth.mjs';
import {makePdf} from '@/lib/pdf';
export const dynamic='force-dynamic';
async function handle(request:Request){return handlePublicAccountRequest(request,{db:env.DB,config:publicEmailAuthConfiguration(env),renderProfile:user=>makePdf(user,{demo:false})});}
export const GET=handle;
export const POST=handle;
