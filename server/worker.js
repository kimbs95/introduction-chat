import {makeRetriever, extractiveAnswer, previousTopic} from '../web/search.js';
import {evidenceMessages, checkedAnswer} from '../web/llm.js';

const site = 'https://kimbs95.github.io/introduction-chat/';
const origin = new URL(site).origin;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const result = (body, status = 200) => Response.json(body, {status, headers:{
  'Access-Control-Allow-Origin':origin, 'Cache-Control':'no-store', 'Vary':'Origin'
}});
const fail = (message, status) => result({error:message}, status);
const seconds = () => Math.floor(Date.now()/1000);

async function readInput(request) {
  const reader = request.body?.getReader();
  if (!reader) throw Error();
  const bytes = [];
  for (;;) {
    const {done,value} = await reader.read();
    if (done) break;
    if (bytes.length + value.length > 4096) { await reader.cancel(); throw Error(); }
    bytes.push(...value);
  }
  return JSON.parse(new TextDecoder().decode(new Uint8Array(bytes)));
}

async function loadPublic(file) {
  const response = await fetch(site+'data/'+file+'.json',{cf:{cacheTtl:60},signal:AbortSignal.timeout(10000)});
  if (!response.ok) throw Error();
  return response.json();
}

export default {async fetch(request, env) {
  const path = new URL(request.url).pathname;
  if (!['/verify','/chat'].includes(path)) return fail('경로를 확인하세요.',404);
  if (request.headers.get('Origin') !== origin) return fail('사이트에서 접속해 주세요.',403);
  if (request.method==='OPTIONS') return new Response(null,{headers:{
    'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'POST, OPTIONS',
    'Access-Control-Allow-Headers':'Authorization, Content-Type','Vary':'Origin'
  }});
  if (request.method!=='POST') return fail('POST만 지원합니다.',405);
  const code = /^Bearer (iv_[a-f0-9]{64})$/.exec(request.headers.get('Authorization')||'')?.[1];
  if (!code) return fail('초대코드를 확인해 주세요.',401);
  try {
    const bytes = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(code));
    const hash = Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
    const db = env.DB;
    const invite = await db.prepare('SELECT id FROM invites WHERE code_hash=? AND revoked=0 AND expires_at>?').bind(hash,seconds()).first();
    if (!invite) return fail('초대코드가 만료되었거나 유효하지 않습니다.',401);
    if (path==='/verify') return result({ok:true});
    if (!env.OPENAI_API_KEY) return fail('운영자가 LLM 연결을 준비 중입니다.',503);
    let input;
    try { input=await readInput(request); } catch { return fail('질문 형식이 올바르지 않습니다.',400); }
    const q=typeof input?.question==='string' ? input.question.trim() : '';
    if (!q || q.length>500 || !uuid.test(input.requestId) || !uuid.test(input.conversation)) return fail('질문과 대화 번호를 확인하세요.',400);
    const key=[invite.id,input.requestId];
    const existing=await db.prepare('SELECT * FROM turns WHERE invite_id=? AND request_id=?').bind(...key).first();
    if (existing) {
      if (existing.question!==q || existing.conversation!==input.conversation || existing.status!=='done') return fail('이미 접수된 질문입니다. 잠시 후 다시 질문하세요.',409);
      return result({answer:existing.answer,sources:JSON.parse(existing.sources)});
    }
    const now=seconds();
    const reserved=await db.prepare(`INSERT OR IGNORE INTO turns(invite_id,request_id,conversation,created_at,question)
      SELECT ?,?,?,?,? WHERE (SELECT count(*) FROM turns WHERE invite_id=? AND created_at>=?)<10
      AND (SELECT count(*) FROM turns WHERE invite_id=? AND created_at>=?)<100`)
      .bind(...key,input.conversation,now,q,invite.id,now-60,invite.id,now-86400).run();
    if (!reserved.meta.changes) return fail('질문 한도에 도달했거나 이미 접수한 질문입니다.',429);
    try {
      const [profile,knowledge,previous]=await Promise.all([loadPublic('profile'),loadPublic('knowledge'),
        db.prepare("SELECT question FROM turns WHERE invite_id=? AND conversation=? AND status='done' ORDER BY created_at DESC,rowid DESC LIMIT 1").bind(invite.id,input.conversation).first()]);
      const history=previous?[{role:'user',content:previous.question}]:[];
      const found=makeRetriever(knowledge,profile.name,[profile.fullName,...(profile.aliases||[])])(q,history).slice(0,3);
      let answer=extractiveAnswer(found);
      if (found.length) {
        const response=await fetch('https://api.openai.com/v1/chat/completions',{method:'POST',
          signal:AbortSignal.timeout(40000),headers:{Authorization:'Bearer '+env.OPENAI_API_KEY,'Content-Type':'application/json'},
          body:JSON.stringify({model:'gpt-4.1-mini',store:false,temperature:0,max_completion_tokens:350,
            messages:evidenceMessages(profile.name,q,found,previousTopic(q,history))})});
        if (!response.ok) throw Error();
        const generated=checkedAnswer((await response.json()).choices?.[0],profile.name,found,q);
        if (generated) answer=generated;
      }
      const sources=found.map(({id,source,location})=>({id,source,location}));
      await db.prepare("UPDATE turns SET answer=?,sources=?,status='done' WHERE invite_id=? AND request_id=?")
        .bind(answer,JSON.stringify(sources),...key).run();
      return result({answer,sources});
    } catch {
      await db.prepare("UPDATE turns SET status='failed' WHERE invite_id=? AND request_id=?").bind(...key).run();
      return fail('답변을 생성하지 못했습니다. 잠시 후 다시 시도해 주세요.',502);
    }
  } catch { return fail('서버 연결을 확인해 주세요.',503); }
}};
