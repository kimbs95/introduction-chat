# 김병성의 대화형 이력서

[이력서 열기](https://kimbs95.github.io/introduction-chat/) · [공개 문서 폴더](./content/documents/)

방문자는 개인 초대코드로 인증한 뒤 질문을 보냅니다. Cloudflare Worker가 공개 이력서의 관련 문단을 찾아 OpenAI API로 답변을 생성하고 질문과 답변을 초대별로 D1에 기록합니다. 모델 다운로드는 필요하지 않습니다.

[서버 배포, API 키 설정, 초대 발급·회수 및 로그 조회](server/SETUP.md)

## 이력서 업데이트

1. GitHub에서 [content/documents](./content/documents/)를 엽니다.
2. **Add file → Upload files**를 선택해 공개할 이력서를 올리고 **Commit changes**로 `main`에 저장합니다. 기존 `about.md`도 직접 편집하거나 교체할 수 있습니다.
3. [Actions](https://github.com/kimbs95/introduction-chat/actions/workflows/pages.yml)에서 `build`와 `deploy`가 완료되면 새로고침합니다. 삭제하거나 바꾼 자료도 다음 배포에 반영됩니다.

공개 이름, 화면 소개, 기술 태그, 링크와 추천 질문은 [content/profile.json](./content/profile.json)에서 바꿉니다. 이 프로필도 검색에 쓰이므로 문서를 교체할 때 함께 확인해 주세요. 이 저장소와 배포되는 검색 데이터는 공개됩니다. 이력서는 방문자에게 보여줄 내용만 담은 사본으로 올려 주세요.

## 지원 형식

| 파일 | 정리 방법과 출처 표시 |
| --- | --- |
| 엑셀 `.xlsx`, `.xls` | 첫 번째 비어 있지 않은 표시 행에 열 이름을 씁니다. 표의 각 행을 시트 이름·행 번호와 함께 찾습니다. `.xlsx` 수식 결과를 보여주려면 값으로 붙여넣으세요. |
| 한글 `.hwp`, `.hwpx` | 본문 텍스트를 문단 단위로 찾습니다. `.hwp`는 일반 HWP 5.x 형식을 지원합니다. 암호나 배포용 설정이 있는 파일은 보호를 해제한 HWPX 사본으로 올려 주세요. |
| 워드 `.docx`, PDF `.pdf` | 워드는 본문 문단, PDF는 페이지로 표시합니다. 스캔한 PDF는 먼저 문자 인식(OCR)을 적용해야 합니다. |
| `.csv`, `.md`, `.txt` | CSV는 열 이름과 데이터 행, 마크다운과 텍스트는 문단을 읽습니다. |

예를 들어 `경력.xlsx`의 첫 행에 **프로젝트명 / 담당 업무 / 사용 기술 / 성과**를 쓰고 아래에 프로젝트를 한 행씩 적으면, 방문자는 어느 자료에서 답이 나왔는지 확인할 수 있습니다.

자료는 하위 폴더까지 읽습니다. 파일당 10 MiB, 최대 100개이며 검색용 텍스트 조각 전체는 4 MiB까지입니다. 손상된 파일 등으로 빌드가 실패하면 Actions의 `Build public data and website` 단계에서 파일 이름과 이유를 확인할 수 있습니다. 직전 성공한 사이트는 계속 열립니다.

## 작동 방식

`main`에 변경 사항을 올리면 [Pages 워크플로](./.github/workflows/pages.yml)가 Python으로 문서를 추출하고, 검색 데이터와 웹 파일을 `dist/`에 만든 다음 GitHub Pages에 배포합니다. 저장소의 **Settings → Pages → Source**는 **GitHub Actions**를 사용합니다. Pull request에서는 빌드와 테스트를 실행합니다.

공개 페이지는 프로필과 출처를 보여줍니다. 서버가 모든 질문에서 초대를 검증하고, 현재 배포된 검색 자료로 근거를 선택합니다.

## 로컬에서 실행하기

Windows PowerShell에서 Python 3.12와 Node.js 22 이상으로 실행합니다.

```powershell
npm ci --ignore-scripts
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe scripts/build.py
.\.venv\Scripts\python.exe -m http.server 8000 --directory dist
```

브라우저에서 [localhost:8000](http://localhost:8000/)을 엽니다. 자료 수정 후 빌드를 다시 실행하고 페이지를 새로고침합니다. macOS와 Linux에서는 `python3 -m venv .venv`로 시작하고 이후 명령의 Python 경로로 `.venv/bin/python`을 사용합니다.

문서 추출 테스트는 가상환경에서 `python -m unittest discover -s tests -p "test_*.py" -v`로, 검색 테스트는 Node.js 22 이상에서 `npm test`로 실행합니다.
