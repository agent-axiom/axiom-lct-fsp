import { env } from 'cloudflare:workers';
import { freshState, upgradeState, DomainError } from './domain.mjs';
export function database() { if(!env.DB) throw new Error('Database unavailable'); return env.DB; }
export async function load(owner:string) {
 const db=database();
 await db.prepare('INSERT OR IGNORE INTO workspaces (id, state, revision) VALUES (?, ?, 0)').bind(owner,JSON.stringify(freshState())).run();
 const row=await db.prepare('SELECT state, revision FROM workspaces WHERE id = ?').bind(owner).first<{state:string,revision:number}>();
 if(!row) throw new Error('Workspace unavailable'); return {state:upgradeState(JSON.parse(row.state)),revision:row.revision};
}
export async function mutate<T>(owner:string, callback:(state:ReturnType<typeof freshState>)=>T) {
 for(let i=0;i<4;i++){const {state,revision}=await load(owner);const result=callback(state); const res=await database().prepare('UPDATE workspaces SET state = ?, revision = revision + 1 WHERE id = ? AND revision = ?').bind(JSON.stringify(state),owner,revision).run();if(res.meta.changes===1)return result;}
 throw new DomainError('Данные изменились. Повторите действие.',409);
}
