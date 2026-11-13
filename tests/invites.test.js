import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createHash,randomUUID,randomBytes} from 'node:crypto';
import worker from '../server/worker.js';

test('invite authentication, grounded reply, replay, separate logs and revocation', async t=>{
 const sql=new DatabaseSync(':memory:');
 sql.exec(readFileSync(new URL('../server/schema.sql',import.meta.url),'utf8'));
 const DB={prepare(query){const s=sql.prepare(query);return {bind(...args){return {
   first:async()=>s.get(...args),run:async()=>({meta:s.run(...args)})
 };}};}};
 const env={DB,OPENAI_API_KEY:'test'};
 const code=()=> 'iv_'+randomBytes(32).toString('hex');
 const a=code(), b=code();
 for(const [id,key] of [['A',a],['B',b]])sql.prepare("INSERT INTO invites VALUES(?,?,?,unixepoch(),unixepoch()+500,0)").run(id,id,createHash('sha256').update(key).digest('hex'));
 const turn={requestId:randomUUID(),conversation:randomUUID(),question:'기술 스택은?'};
 const call=(path,token)=>worker.fetch(new Request('https://worker.example/'+path,{method:'POST',headers:{Origin:'https://kimbs95.github.io',Authorization:'Bearer '+token},body:JSON.stringify(turn)}),env);
 let calls=0;
 t.mock.method(globalThis,'fetch',async url=>{
   if(url.endsWith('profile.json'))return Response.json({name:'김병성'});
   if(url.endsWith('knowledge.json'))return Response.json({chunks:[{id:'x',source:'기술.md',location:'1',text:'주요 기술 스택은 Java입니다.'}]});
   calls++;return Response.json({choices:[{finish_reason:'stop',message:{content:'Java를 사용합니다.'}}]});
 });
 assert.equal((await call('chat',code())).status,401);
 assert.equal((await call('verify',a)).status,200);
 const reply=await call('chat',a);assert.equal(reply.status,200);assert.equal((await reply.json()).answer,'Java를 사용합니다.');
 assert.equal((await call('chat',a)).status,200);assert.equal(calls,1);
 assert.equal((await call('chat',b)).status,200);assert.equal(calls,2);
 assert.equal(sql.prepare("SELECT count(*) AS n FROM turns WHERE status='done' AND answer IS NOT NULL").get().n,2);
 sql.exec("UPDATE invites SET revoked=1 WHERE id='A'; UPDATE invites SET expires_at=0 WHERE id='B'");
 assert.equal((await call('chat',a)).status,401);assert.equal((await call('verify',b)).status,401);
 sql.close();
});
