# 초대 전용 챗봇 설정

## 운영자가 처음 한 번 할 일
Node.js 22 이상에서 프로젝트를 내려받고 저장소 루트에서 실행합니다. Cloudflare 로그인은 소유자 계정으로 진행합니다.

```powershell
cd server
npx wrangler@4 login
npx wrangler@4 d1 create introduction-chat
Copy-Item wrangler.example.json wrangler.json
```

생성 결과의 database_id를 wrangler.json의 REPLACE_WITH_D1_DATABASE_ID에 붙여넣습니다. database_id는 비밀 키가 아닙니다. macOS/Linux에서는 Copy-Item 대신 cp를 사용하세요. 이어서 실행합니다.

```powershell
npx wrangler@4 d1 execute introduction-chat --remote --file=schema.sql
npx wrangler@4 deploy
npx wrangler@4 secret put OPENAI_API_KEY
```

마지막 명령의 입력창에 OpenAI Platform에서 생성한 프로젝트 API 키를 입력합니다. API 사용 요금이 적용됩니다. Worker의 Settings → Variables and Secrets에서도 같은 이름으로 Secret을 등록할 수 있습니다.

GitHub 저장소의 Settings → Secrets and variables → Actions → **Variables**에 CHAT_API_URL을 만들고 deploy가 출력한 HTTPS Worker 주소만 입력합니다. 끝에 /chat을 붙이지 않습니다. 이후 Actions → Build and deploy resume → Run workflow → main을 실행합니다. GitHub에는 OpenAI 키가 필요하지 않습니다. API 주소를 설정하기 전에는 공개 이력서만 열리고 챗봇은 잠깁니다. 이력서 문서를 갱신할 때는 기존처럼 content/documents에 커밋합니다.

## 초대 발급과 회수
server 폴더에서 다음 명령을 실행합니다.

```powershell
node admin.mjs issue "채용담당자-A" 30
```

출력된 INSERT 문을 Cloudflare → Storage & databases → D1 → introduction-chat → Console에서 실행해야 초대가 활성화됩니다. iv_로 시작하는 원본 코드는 해당 방문자에게만 전달하고 초대 ID를 보관하세요. DB에는 코드의 SHA-256 해시만 저장됩니다. 30은 유효 일수입니다. 1명당 코드를 1개 발급합니다. 코드를 공유하면 같은 사용자의 로그로 기록됩니다. 새로고침하면 다시 인증합니다.

아래 명령은 각각 조회 SQL과 회수 SQL을 출력합니다. 출력된 SQL을 같은 D1 Console에서 실행하세요.

```powershell
node admin.mjs logs 초대ID
node admin.mjs revoke 초대ID
```

전체 초대 목록은 `SELECT id,label,expires_at,revoked FROM invites;`로 확인합니다. 완료된 질문·답변과 실패 상태가 저장되며, 새 대화는 같은 초대에서 conversation 값이 달라집니다. 질문 한도는 코드당 최근 1분 10건, 최근 24시간 100건입니다. 로그는 삭제하기 전까지 보관됩니다. 특정 초대의 기록 삭제는 `DELETE FROM turns WHERE invite_id='초대ID';`로 할 수 있습니다. 브라우저에는 로그 열람·초대 발급용 관리자 API가 없습니다.
