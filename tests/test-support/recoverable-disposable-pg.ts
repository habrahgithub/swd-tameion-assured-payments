// Test-only local helper adapted from SENTINEL exact-C1 probes; never selects an inherited hosted target.
import {spawn,spawnSync} from 'node:child_process';
import {readFileSync,readdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {vi} from 'vitest';
import {DemoStateConflictError} from '../../src/server/supabase-demo-state-repository';
export const main=process.env.TAMEION_RECOVERY_DISPOSABLE_PG_URL!;
export const enabled=Boolean(main&&process.env.TAMEION_RECOVERY_DISPOSABLE_PG_CONFIRMED==='1');
export function validate(url:string){if(!enabled)throw Error('Explicit disposable database confirmation required');const u=new URL(url);if(!['postgres:','postgresql:'].includes(u.protocol)||u.hostname!=='127.0.0.1'||u.port!=='56468'||!/^\/tameion_recovery_disposable_[A-Za-z0-9_]+$/.test(u.pathname))throw Error('Non-disposable target refused');return url;}
export const literal=(v:unknown)=>`'${JSON.stringify(v).replaceAll("'","''")}'::jsonb`;
const args=(url:string)=>['-X','-At','-v','ON_ERROR_STOP=1','--dbname',validate(url)];
export function query(sql:string,url=main){const r=spawnSync('/usr/bin/psql',args(url),{input:sql,encoding:'utf8',timeout:15000});if(r.status!==0)throw Error(r.stderr||String(r.error));return r.stdout.trim();}
export function run(sql:string,url=main,onData?:(s:string)=>void){const p=spawn('/usr/bin/psql',args(url));let out='',err='';p.stdout.on('data',s=>{out+=s;onData?.(out);});p.stderr.on('data',s=>err+=s);const done=new Promise<string>((resolve,reject)=>{p.on('error',reject);p.on('close',code=>code===0?resolve(out.trim()):reject(Error(err)));});p.stdin.end(sql);return done;}
export const migrations=resolve(import.meta.dirname,'../../supabase/migrations');
export const migrationNames=readdirSync(migrations).filter(n=>n.endsWith('.sql')).sort();
export function newDatabase(empty=false){const name='tameion_recovery_disposable_'+randomUUID().replaceAll('-','');query(`create database ${name} template template0;`);const u=new URL(main);u.pathname='/'+name;if(!empty)applyMigrations(u.toString());return u.toString();}
export function applyMigrations(url:string,latest=true){for(const name of migrationNames.filter(n=>latest||!n.startsWith('20261020')))query(readFileSync(resolve(migrations,name),'utf8'),url);}
export function seed(url:string,namespace:string,snapshot:unknown){query(`insert into tameion_private.demo_state(namespace,revision,snapshot) values('${namespace}',1,${literal(snapshot)});`,url);}
export function repository(url:string,namespace:string){return {loadExisting:vi.fn(async()=>JSON.parse(query(`select jsonb_build_object('revision',revision,'snapshot',snapshot) from tameion_private.demo_state where namespace='${namespace}';`,url))),compareAndSet:vi.fn(async(_ns:string,revision:number,next:unknown)=>{const out=await run(`set role service_role;select public.tameion_state_compare_and_set('${namespace}',${revision},${literal(next)});`,url);const r=JSON.parse(out.split('\n').at(-1)!);if(!r.accepted)throw new DemoStateConflictError();return r.revision;}),assertRecoveryWorkflowCapability:async()=>{const c=JSON.parse(query('set role service_role;select public.tameion_recovery_capabilities();',url).split('\n').at(-1)!);if(!c.immutable_recovery_receipts)throw Error('Missing capability');}};}
export const pg='/pg-runtime/usr/lib/postgresql/17/bin/pg_ctl',data='/evidence/pg-data';
export function crashRestart(){if(process.env.TAMEION_RECOVERY_DISPOSABLE_PG_ISOLATED!=='1'||!readFileSync('/evidence/writer-c2-owned','utf8').includes('C2'))throw Error('Owned isolated runtime required');validate(main);for(const argv of [['-D',data,'-m','immediate','-w','stop'],['-D',data,'-l','/evidence/pg-server.log','-o','-h 127.0.0.1 -p 56468 -k /tmp -c fsync=on -c synchronous_commit=on -c full_page_writes=on','-w','start']]){const r=spawnSync(pg,argv,{encoding:'utf8',timeout:15000});if(r.status!==0)throw Error(r.stderr+r.stdout);}}
