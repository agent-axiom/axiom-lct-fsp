/** Keep the configured public origin canonical without accepting credentials or paths. */
export function accountOrigin(value:unknown):string{
 if(typeof value!=='string'||!value.trim())return '';
 try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password?url.origin:'';}catch{return '';}
}
