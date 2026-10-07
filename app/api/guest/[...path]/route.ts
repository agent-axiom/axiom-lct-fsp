import {env} from 'cloudflare:workers';
import {handleGuestRequest} from '@/lib/guest-demo.mjs';
import {makePdf} from '@/lib/pdf';
export const dynamic='force-dynamic';
async function handle(request:Request){return handleGuestRequest(request,{db:env.DB,renderProfile:user=>makePdf(user)});}
export const GET=handle;
export const POST=handle;
