const $ = selector => document.querySelector(selector);
const node = (tag, text, className) => {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
};
let profile, knowledge, api, credential = '', busy = false;
let conversation = crypto.randomUUID();
const questionInput = $('#question');
const messages = $('#messages');
const dialog = $('#documents-dialog');

function showDocs(sourceId) {
  if (!knowledge) return;
  $('#document-list').replaceChildren();
  for (const doc of knowledge.documents) {
    const details = node('details', undefined, 'doc-group');
    const summary = node('summary', undefined, 'doc-heading');
    summary.append(node('strong', doc.name), node('span', `${doc.type.toUpperCase()} · ${doc.chunks}개 항목`));
    details.append(summary);
    const records = knowledge.chunks.filter(chunk => chunk.documentId === doc.id);
    let loaded = false;
    const populate = () => {
      if (loaded) return;
      loaded = true;
      for (const chunk of records) {
        const article = node('article', undefined, 'doc-excerpt');
        article.id = `source-${chunk.id}`;
        if (chunk.id === sourceId) article.classList.add('highlight');
        article.append(node('h4', chunk.location), node('p', chunk.text));
        details.append(article);
      }
    };
    details.addEventListener('toggle', () => { if (details.open) populate(); });
    if (records.some(chunk => chunk.id === sourceId)) { populate(); details.open = true; }
    $('#document-list').append(details);
  }
  dialog.showModal();
  if (sourceId) requestAnimationFrame(() => document.getElementById(`source-${sourceId}`)?.scrollIntoView({block:'center'}));
}

function scrollBottom() {
  const container = $('#chat-scroll');
  container.scrollTop = container.scrollHeight;
}

function addMessage(role, text, sources = [], label = '') {
  const message = node('article', undefined, `message ${role}`);
  message.append(node('div', role === 'user' ? 'YOU' : label, 'message-label'));
  message.append(node('div', text, 'message-body'));
  if (sources.length) {
    const pills = node('div', undefined, 'source-pills');
    sources.forEach((source, i) => {
      const button = node('button', `[${i + 1}] ${source.source} · ${source.location}`, 'source-pill');
      button.type = 'button';
      button.addEventListener('click', () => showDocs(source.id));
      pills.append(button);
    });
    message.append(pills);
  }
  messages.append(message);
  scrollBottom();
}

function lock(locked) {
  questionInput.disabled = locked;
  $('#send').disabled = locked;
  $('#reset-chat').disabled = busy || !credential;
}

async function call(path, code, body) {
  const res = await fetch(api + path, {method:'POST', credentials:'omit', redirect:'error',
    signal:AbortSignal.timeout(55000), headers:{Authorization:'Bearer '+code,'Content-Type':'application/json'},
    body:JSON.stringify(body)});
  const data = await res.json();
  if (!res.ok) {
    if (res.status === 401) {
      credential = '';
      $('#invite-form').hidden = false;
      $('#chat-welcome').hidden = true;
      messages.replaceChildren();
      conversation = crypto.randomUUID();
      lock(true);
    }
    throw new Error(data.error || '서버에 연결할 수 없습니다.');
  }
  return data;
}

$('#invite-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (busy || !api) return;
  const code = $('#invite').value.trim();
  busy = true;
  const button = $('#invite-form button');
  button.disabled = true;
  try {
    await call('/verify', code, {});
    credential = code;
    $('#invite').value = '';
    $('#invite-form').hidden = true;
    $('#chat-welcome').hidden = false;
    $('#feedback').textContent = '';
  } catch (e) { $('#feedback').textContent = e.message; }
  finally { busy = false; button.disabled = false; lock(!credential); }
  if (credential) questionInput.focus();
});

async function sendQuestion(question) {
  const query = question.trim();
  if (!credential || busy || !query || query.length > 500) return;
  busy = true;
  lock(true);
  $('#chat-welcome').hidden = true;
  addMessage('user',query);
  $('#feedback').textContent = '이력서를 참고해 답변을 작성하고 있습니다…';
  try {
    const data = await call('/chat',credential,{question:query,conversation,requestId:crypto.randomUUID()});
    addMessage('assistant',data.answer,data.sources.filter(s=>knowledge.chunks.some(c=>c.id===s.id)),profile.name+' · 답변');
    $('#feedback').textContent = '';
    questionInput.value = '';
  } catch (e) { $('#feedback').textContent = e.message; }
  finally { busy = false; lock(!credential); }
  if (credential) questionInput.focus();
}

$('#chat-form').addEventListener('submit', event => { event.preventDefault(); sendQuestion(questionInput.value); });
questionInput.addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
    event.preventDefault();
    sendQuestion(questionInput.value);
  }
});
questionInput.addEventListener('input', () => { questionInput.style.height = 'auto'; questionInput.style.height = Math.min(questionInput.scrollHeight, 120) + 'px'; });
$('#reset-chat').addEventListener('click', () => {
  if (busy || !credential) return;
  conversation = crypto.randomUUID();
  messages.replaceChildren();
  $('#chat-welcome').hidden = false;
  $('#feedback').textContent = '';
  questionInput.value = '';
  questionInput.style.height = '';
  if (credential) questionInput.focus({preventScroll: true});
});
document.querySelectorAll('[data-open-docs]').forEach(button => button.addEventListener('click', () => showDocs()));
$('#close-documents').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', event => { if (event.target === dialog) { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close(); } });
$('#print-button').addEventListener('click', () => window.print());

function renderProfile() {
  document.title = `${profile.name} — 대화하는 이력서`;
  document.querySelector('meta[name="description"]').content = profile.summary;
  $('#brand-name').textContent = profile.name;
  $('#brand-mark').textContent = profile.name[0].toUpperCase();
  $('#profile-initial').textContent = profile.name[0].toUpperCase();
  $('.ask-link').textContent = `${profile.name}에게 질문하기 ↗`;
  $('#name').textContent = profile.name;
  $('#role').textContent = profile.role;
  $('#eyebrow').textContent = profile.eyebrow;
  $('#summary').textContent = profile.summary;
  $('#chat-title').textContent = `Ask ${profile.name}.`;
  questionInput.placeholder = `${profile.name}에 대해 궁금한 점을 물어보세요`;
  const lines = profile.headline.split('\n');
  $('#hero-title').replaceChildren();
  lines.forEach((line, index) => { if (index) $('#hero-title').append(node('br')); $('#hero-title').append(node('span', line, index ? 'accent' : '')); });
  $('#hero-title').firstChild.style.color = 'var(--ink)';
  $('#skills').replaceChildren(...(profile.skills || []).map(skill => node('span', skill, 'skill')));
  (profile.focus || []).forEach(focus => {
    const row = node('div', undefined, 'focus-item');
    const body = node('div');
    const line = node('div', undefined, 'focus-line');
    line.append(node('h3', focus.title), node('span', focus.text, 'focus-keywords'));
    body.append(line, node('p', focus.description)); row.append(body); $('#focus-list').append(row);
  });
  (profile.questions || []).forEach(question => {
    const button = node('button', undefined, 'suggestion'); button.type = 'button';
    button.append(node('span', question), node('span', '↗'));
    button.addEventListener('click', () => sendQuestion(question)); $('#suggestions').append(button);
  });
  for (const [label, value] of Object.entries(profile.links || {})) {
    if (!value) continue;
    const href = label === 'email' ? `mailto:${value}` : value;
    if (!(label === 'email' ? /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(value) : /^https:\/\//i.test(href))) continue;
    const link = node('a', `${label === 'email' ? 'Email' : label === 'github' ? 'GitHub' : 'Blog'} ↗`);
    link.href = href; link.rel = 'noopener noreferrer'; link.target = '_blank'; $('#social-links').append(link);
  }
  $('#mode-label').textContent = '문서 기반 LLM';
  $('#mode-note').textContent = '초대코드별로 질문과 답변이 기록됩니다.';
  $('#source-count').textContent = `공개 자료 ${knowledge.documents.length}개`;
  $('#updated-at').textContent = `자료 업데이트 ${new Intl.DateTimeFormat('ko-KR', {timeZone:'Asia/Seoul',dateStyle:'medium'}).format(new Date(knowledge.updatedAt))}`;
}

try {
  [profile, knowledge, {api}] = await Promise.all(['profile', 'knowledge','config'].map(async filename => {
    const response = await fetch(new URL(`./data/${filename}.json`, import.meta.url), {cache:'no-cache'});
    if (!response.ok) throw new Error('자료 요청 실패');
    return response.json();
  }));
  renderProfile();
  lock(true);
  $('#invite-form button').disabled = !api;
  if (!api) $('#feedback').textContent = '운영자가 서버 API 연결을 준비하고 있습니다.';

} catch {
  $('#mode-label').textContent = '자료를 불러오지 못했어요';
  $('#summary').textContent = '프로필을 불러오지 못했습니다. 잠시 후 새로고침해 주세요.';
  $('#feedback').textContent = '자료를 불러오지 못했습니다. 로컬에서는 HTTP 서버로 실행하고, 배포 상태를 확인하세요.';
  $('#mode-note').textContent = '자료가 준비되면 대화를 시작할 수 있어요.';
}
