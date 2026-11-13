// Print SQL for the owner's Cloudflare D1 Console. No administrator endpoint.
import {randomBytes,randomUUID,createHash} from 'node:crypto';
const [action,arg,daysText='30']=process.argv.slice(2);
const quote=s=>"'"+s.replaceAll("'","''")+"'";
if(action==='issue' && arg?.trim() && arg.length<=100 && /^\d+$/.test(daysText) && +daysText>=1 && +daysText<=365){
 const code='iv_'+randomBytes(32).toString('hex'), id=randomUUID();
 const hash=createHash('sha256').update(code).digest('hex');
 console.log('수신자에게 개별 전달할 초대코드 (이 화면에서만 표시)\n'+code);
 console.log('D1 Console에서 실행할 SQL\nINSERT INTO invites(id,label,code_hash,created_at,expires_at) VALUES ('+
   [quote(id),quote(arg),quote(hash),'unixepoch()','unixepoch()+'+(+daysText*86400)].join(',')+');');
 console.log('초대 ID '+id);
} else if (['logs','revoke'].includes(action) && /^[0-9a-f-]{36}$/i.test(arg||'')){
 console.log(action==='revoke'?'UPDATE invites SET revoked=1 WHERE id='+quote(arg)+';':
  "SELECT datetime(created_at,'unixepoch','+9 hours') AS kst,conversation,question,answer,status FROM turns WHERE invite_id="+quote(arg)+' ORDER BY created_at DESC,rowid DESC;');
} else {console.error('issue "방문자 이름" [유효일 1~365] | logs 초대ID | revoke 초대ID');process.exitCode=1;}
