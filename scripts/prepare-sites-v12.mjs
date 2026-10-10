import {cpSync,existsSync,mkdirSync,readFileSync,readdirSync,rmSync,writeFileSync,realpathSync,lstatSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=realpathSync(fileURLToPath(new URL('..',import.meta.url)));
const args=process.argv.slice(2);
if(args.length!==2||args[0]!=='--output'||!path.isAbsolute(args[1]))throw new Error('Usage: node scripts/prepare-sites-v12.mjs --output /absolute/empty/staging-directory');
const output=path.resolve(args[1]);
if(output===root||output.startsWith(root+path.sep)||root.startsWith(output+path.sep))throw new Error('Staging must be outside the checkout, not its ancestor.');
if(existsSync(output)&&(realpathSync(output)!==output||readdirSync(output).length))throw new Error('Output must be an empty real directory.');
let ancestor=path.dirname(output);while(!existsSync(ancestor))ancestor=path.dirname(ancestor);
if(realpathSync(ancestor)!==ancestor)throw new Error('Symlinked output parent is not allowed.');
const git=(...a)=>execFileSync('git',a,{cwd:root,encoding:'utf8'}).trim();
git('diff','--quiet','HEAD','--');git('diff','--cached','--quiet','--');
const commit=git('rev-parse','HEAD');
const files=execFileSync('git',['ls-files','--cached','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean);
if(!files.includes('migration-profiles/sites-v12/manifest.json'))throw new Error('Commit the profile before staging.');
const profile=JSON.parse(readFileSync(path.join(root,'migration-profiles/sites-v12/manifest.json'),'utf8'));
const hash=b=>createHash('sha256').update(b).digest('hex');
if(JSON.parse(readFileSync(path.join(root,'.openai/hosting.json'),'utf8')).project_id!==profile.projectId)throw new Error('Profile is bound to a different Site.');
if(hash(readFileSync(path.join(root,'db/schema.ts')))!==profile.schemaSHA256)throw new Error('Schema changed; regenerate and test the deployment profile.');
for(const f of profile.files){
 if(!files.includes(f.source)||!f.destination.startsWith('drizzle/')||f.destination.split('/').includes('..')||hash(readFileSync(path.join(root,f.source)))!==f.sha256)throw new Error('Invalid or stale profile mapping: '+f.source);
}
mkdirSync(output,{recursive:true});
for(const f of files){if(lstatSync(path.join(root,f)).isSymbolicLink())throw new Error('Tracked symlinks are not supported');if(f.split('/').includes('..'))throw new Error('Invalid tracked path');const dest=path.join(output,f);mkdirSync(path.dirname(dest),{recursive:true});cpSync(path.join(root,f),dest,{dereference:false});}
// Only remove the just-copied staging migration folder, never the checkout.
rmSync(path.join(output,'drizzle'),{recursive:true});
for(const f of profile.files){const dest=path.join(output,f.destination);mkdirSync(path.dirname(dest),{recursive:true});cpSync(path.join(root,f.source),dest);}
const sourceFiles={};
function walk(dir){for(const name of readdirSync(dir).sort()){const f=path.join(dir,name),relative=path.relative(output,f);if(lstatSync(f).isDirectory())walk(f);else sourceFiles[relative]=hash(readFileSync(f));}}

walk(output);
writeFileSync(path.join(output,'SOURCE-PROVENANCE.json'),JSON.stringify({profile:profile.id,applicationSourceCommit:commit,applicationBaseCommit:profile.applicationBaseCommit,deployedBaselineCommit:profile.deployedSourceCommit,migrationFiles:profile.files.map(({destination,sha256})=>({path:destination,sha256})),sourceSHA256:sourceFiles},null,2)+'\n');
console.log(JSON.stringify({staged:true,output,sourceCommit:commit,profile:profile.id,files:Object.keys(sourceFiles).length+1,published:false}));
