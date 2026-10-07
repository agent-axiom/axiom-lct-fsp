import {env} from 'cloudflare:workers';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {handleAccountRequest} from '@/lib/real-account-http.mjs';
import {makePdf} from '@/lib/pdf';
import {realAccountsConfiguration} from '@/lib/real-accounts.mjs';
export const dynamic='force-dynamic';
async function handle(request:Request){const user=await getChatGPTUser();return handleAccountRequest(request,{principal:user?{issuer:'sites-chatgpt',subject:user.userId}:null,db:env.DB,config:realAccountsConfiguration(env),renderProfile:user=>makePdf(user,{demo:false})});}
export const GET=handle;
export const POST=handle;
