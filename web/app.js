import {makeRetriever, extractiveAnswer, previousTopic} from './search.js';
import {generateReply} from './llm.js';

const $ = selector => document.querySelector(selector);
const node = (tag, text, className) => {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
};
let profile, knowledge, retrieve;
let history = [];
let activeTurn = null;
let modelEnabled = false;
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

function finishTurn(turn, text, label, notice = '') {
  if (activeTurn !== turn) return;
  clearTimeout(turn.timer);
  activeTurn = null;
  addMessage('assistant', text, turn.sources, label);
  history = [...history, {role: 'user', content: turn.question}].slice(-3);
  $('#model-actions').hidden = true;
  $('#feedback').textContent = notice;
  questionInput.disabled = false;
  $('#send').disabled = false;
  questionInput.focus({preventScroll: true});
}

function showExcerpts(notice = '') {
  const turn = activeTurn;
  if (!turn) return;
  if (turn.running) {
    modelEnabled = false;
    turn.controller.abort();
  }
  finishTurn(turn, extractiveAnswer(turn.sources), '문서 원문', notice);
}

async function startGeneration() {
  const turn = activeTurn;
  if (!turn || turn.running) return;
  turn.running = true;
  modelEnabled = true;
  $('#start-model').hidden = true;
  function onStatus(text) {
    if (activeTurn !== turn) return;
    if ($('#feedback').textContent !== text) $('#feedback').textContent = text;
    clearTimeout(turn.timer);
    turn.timer = setTimeout(() => {
      if (activeTurn === turn) showExcerpts('모델의 응답이 지연되어 관련 원문을 표시했습니다.');
    }, 180000);
  }
  onStatus('LLM을 준비하고 있습니다…');
  try {
    const answer = await generateReply({
      name: profile.name, question: turn.question, sources: turn.sources,
      previousQuestion: turn.previousQuestion, signal: turn.controller.signal, onStatus,
    });
    if (activeTurn !== turn) return;
    if (answer) finishTurn(turn, answer, profile.name + ' · LLM 답변');
    else finishTurn(turn, extractiveAnswer(turn.sources), '문서 원문', '생성된 답변의 근거를 확인하기 어려워 관련 원문을 표시했습니다.');
  } catch {
    if (activeTurn !== turn) return;
    modelEnabled = false;
    finishTurn(turn, extractiveAnswer(turn.sources), '문서 원문', '이 기기에서 모델을 불러오거나 실행할 수 없어 관련 원문을 표시했습니다.');
  }
}

function sendQuestion(question) {
  const query = question.trim();
  if (activeTurn || !retrieve || !query || query.length > 500) return;
  const turn = {
    question: query, sources: retrieve(query, history).slice(0, 3),
    previousQuestion: previousTopic(query, history), controller: new AbortController(), running: false,
  };
  activeTurn = turn;
  $('#chat-welcome').hidden = true;
  addMessage('user', query);
  questionInput.value = '';
  questionInput.style.height = '';
  questionInput.disabled = true;
  $('#send').disabled = true;
  if (!turn.sources.length) {
    finishTurn(turn, extractiveAnswer([]), '문서 검색');
    return;
  }
  $('#model-actions').hidden = false;
  $('#start-model').hidden = false;
  if (modelEnabled) {
    void startGeneration();
  } else {
    $('#feedback').textContent = 'LLM을 시작하면 모델을 이 기기에 저장합니다(최초 약 398 MB). 저장된 모델은 다시 사용합니다.';
    $('#start-model').focus({preventScroll: true});
  }
}

$('#start-model').addEventListener('click', startGeneration);
$('#show-excerpts').addEventListener('click', () => showExcerpts());
$('#chat-form').addEventListener('submit', event => { event.preventDefault(); sendQuestion(questionInput.value); });
questionInput.addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
    event.preventDefault();
    sendQuestion(questionInput.value);
  }
});
questionInput.addEventListener('input', () => { questionInput.style.height = 'auto'; questionInput.style.height = Math.min(questionInput.scrollHeight, 120) + 'px'; });
$('#reset-chat').addEventListener('click', () => {
  if (activeTurn) {
    clearTimeout(activeTurn.timer);
    activeTurn.controller.abort();
    modelEnabled = false;
  }
  activeTurn = null;
  $('#model-actions').hidden = true;
  questionInput.disabled = !retrieve;
  $('#send').disabled = !retrieve;
  history = [];
  messages.replaceChildren();
  $('#chat-welcome').hidden = false;
  $('#feedback').textContent = '';
  questionInput.value = '';
  questionInput.style.height = '';
  if (retrieve) questionInput.focus({preventScroll: true});
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
  $('#mode-note').textContent = '질문과 답변은 이 기기에서 처리합니다.';
  $('#source-count').textContent = `공개 자료 ${knowledge.documents.length}개`;
  $('#updated-at').textContent = `자료 업데이트 ${new Intl.DateTimeFormat('ko-KR', {timeZone:'Asia/Seoul',dateStyle:'medium'}).format(new Date(knowledge.updatedAt))}`;
}

try {
  [profile, knowledge] = await Promise.all(['profile', 'knowledge'].map(async filename => {
    const response = await fetch(new URL(`./data/${filename}.json`, import.meta.url), {cache:'no-cache'});
    if (!response.ok) throw new Error('자료 요청 실패');
    return response.json();
  }));
  retrieve = makeRetriever(knowledge, profile.name, [profile.fullName, ...(profile.aliases || [])]);
  renderProfile();
  questionInput.disabled = false;
  $('#send').disabled = false;
} catch {
  $('#mode-label').textContent = '자료를 불러오지 못했어요';
  $('#summary').textContent = '프로필을 불러오지 못했습니다. 잠시 후 새로고침해 주세요.';
  $('#feedback').textContent = '자료를 불러오지 못했습니다. 로컬에서는 HTTP 서버로 실행하고, 배포 상태를 확인하세요.';
  $('#mode-note').textContent = '자료가 준비되면 대화를 시작할 수 있어요.';
}
