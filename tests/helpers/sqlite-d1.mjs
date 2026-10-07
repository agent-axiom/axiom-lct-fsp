import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
export function sqliteD1(){
  const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');
  const directory=new URL('../../drizzle/',import.meta.url);for(const file of readdirSync(directory).filter(name=>name.endsWith('.sql')).sort())sqlite.exec(readFileSync(new URL(file,directory),'utf8'));
  const adapter={sqlite,failOnceWhen:null,close:()=>sqlite.close(),prepare(sql){const values=[];const statement={sql,bind(...args){values.splice(0,values.length,...args);return statement;},async first(){return sqlite.prepare(sql).get(...values)??null;},async all(){return {results:sqlite.prepare(sql).all(...values),success:true,meta:{changes:0}};},async run(){const result=sqlite.prepare(sql).run(...values);return {success:true,results:[],meta:{changes:Number(result.changes)}};},execute(){if(adapter.failOnceWhen?.test(sql)){adapter.failOnceWhen=null;throw new Error('Injected transaction failure');}if(/^\s*(SELECT|PRAGMA|WITH)/i.test(sql))return {results:sqlite.prepare(sql).all(...values),success:true,meta:{changes:0}};const result=sqlite.prepare(sql).run(...values);return {results:[],success:true,meta:{changes:Number(result.changes)}};}};return statement;},async batch(statements){sqlite.exec('BEGIN IMMEDIATE');try{const results=statements.map(statement=>statement.execute());sqlite.exec('COMMIT');return results;}catch(error){sqlite.exec('ROLLBACK');throw error;}}};
  return adapter;
}
