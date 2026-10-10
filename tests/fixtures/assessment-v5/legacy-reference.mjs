import * as baseline from './baseline-v4.mjs';
import {referenceFor} from '../assessment-quality/reference-oracle.mjs';
import {publicKey} from './fresh-oracle.mjs';
const caches=new Map();
// Enough seeds to cover the finite legacy bank. A missing prompt fails closed.
export function legacyReferenceCache(spec,grade){
 const category=spec+'-'+grade;if(caches.has(category))return caches.get(category);
 const memory=new Map();
 for(let seed=0;seed<10000;seed++){
  const qs=baseline.makeQuestions(spec,grade,seed);
  for(const q of qs){const key=publicKey(q),label=referenceFor(q,qs).answer;
   if(memory.has(key)&&memory.get(key)!==label)throw new Error('Conflicting independently calculated legacy label');memory.set(key,label);
  }
 }
 caches.set(category,memory);return memory;
}
