import { DomainError } from './domain.mjs';
export async function readJsonBody(request,limit=16000){
  const declared=Number(request.headers.get('content-length'));
  if(Number.isFinite(declared)&&declared>limit)throw new DomainError('Запрос слишком большой.',413);
  const reader=request.body?.getReader();if(!reader)throw new DomainError('Пустой запрос.');
  const parts=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();throw new DomainError('Запрос слишком большой.',413);}parts.push(value);}}finally{reader.releaseLock();}
  const body=new Uint8Array(size);let offset=0;for(const part of parts){body.set(part,offset);offset+=part.byteLength;}
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(body));}catch{throw new DomainError('Некорректный JSON.');}
}
