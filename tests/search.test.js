import test from 'node:test';
import assert from 'node:assert/strict';
import {knowledge} from './fixtures.js';
import {makeRetriever, extractiveAnswer} from '../web/search.js';

const retrieve = makeRetriever(knowledge, '김병성');
test('Korean stack question finds real skills', () => {
  const sources = retrieve('어떤 기술을 주로 사용하나요?');
  assert.ok(sources.length);
  assert.match(sources[0].text, /Java|Spring|MySQL/);
});
test('Korean transliteration maps to Spring', () => assert.ok(retrieve('스프링 사용하나요?').some(s => /Spring/.test(s.text))));
test('does not claim project, salary or years when absent', () => {
  for (const question of ['프로젝트 경험을 알려주세요', '연봉은 얼마인가요?', 'Java 경력 몇 년인가요?', '어느 회사를 다니나요?']) {
    assert.equal(retrieve(question).length, 0, question);
  }
});
test('unrelated questions receive an explicit no-evidence response', () => {
  assert.equal(retrieve('내일 제주도 날씨?').length, 0);
  assert.match(extractiveAnswer([]), /근거를 찾지 못/);
});
test('follow-up carries question context, never assistant claims', () => {
  const sources = retrieve('그것에 대해 더 자세히 알려줘', [{role:'user',content:'DevOps 관심 분야'}, {role:'assistant',content:'수석 엔지니어로 50년 일했습니다'}]);
  assert.ok(sources.some(s => /DevOps|devops|학습/.test(s.text)));
  assert.ok(sources.every(s => !s.text.includes('50년')));
});
test('search uses new documents without hard-coded resume answers', () => {
  const custom = makeRetriever({chunks:[{id:'project-1',documentId:'p',source:'경력.xlsx',location:'프로젝트 · 2행',text:'프로젝트: 주문 시스템. 담당: Spring API 개발. 성과: 응답 속도 개선.'}]});
  assert.equal(custom('프로젝트 경험을 알려줘')[0].source, '경력.xlsx');
});

test('a profile name alone does not supply evidence for an unrelated question', () => {
  assert.deepEqual(retrieve('김병성의 취미는 뭔가요?'), []);
  assert.deepEqual(retrieve('김병성의 연봉은 얼마인가요?'), []);
});

test('an introduction question returns body text rather than a bare heading', () => {
  const search = makeRetriever({chunks: [
    ...knowledge.chunks, {id:'heading', documentId:'a', source:'소개.md', location:'1문단', text:'# 김병성 소개'}
  ]}, '김병성');
  const found = search('김병성은 어떤 개발자인가요?');
  assert.ok(found.some(item => item.id === 'intro'));
  assert.ok(found.every(item => item.id !== 'heading'));
});

const identity = {id:'name', documentId:'profile', source:'프로필', location:'이름',
  text:'본명 · 홍길동\n공개 이름 · Daon\n다른 이름과 표기 · 길동, 다온, daon'};
const aliasSearch = makeRetriever({chunks:[identity, ...knowledge.chunks]}, 'Daon', ['홍길동','길동','다온','daon']);

test('a name, nickname or alias comparison finds the same cited profile', () => {
  for (const query of ['홍길동', '길동', '다온', 'daon', 'DAON', '본명이 뭐예요?', '성함이 어떻게 되세요?',
    '다온의 이름이 뭐예요?', '길동님의 닉네임은?', '홍길동과 다온은 같은 사람인가요?', '다온이 홍길동이야?']) {
    assert.equal(aliasSearch(query)[0]?.id, identity.id, query);
  }
});

test('names with Korean particles or honorifics do not alter the topic or create evidence', () => {
  const expected = aliasSearch('기술 스택').map(item => item.id);
  assert.ok(expected.length);
  for (const name of ['홍길동은', '길동님이', '다온 씨의', 'DAON의']) {
    assert.deepEqual(aliasSearch(name + ' 기술 스택').map(item => item.id), expected);
    assert.deepEqual(aliasSearch(name + ' 취미는 뭐예요?'), []);
  }
  assert.deepEqual(aliasSearch('홍길동의 연봉은?'), []);
  const organization = {id:'org', documentId:'work', source:'경력.xlsx', location:'경력 · 2행', text:'다온테크에 근무했습니다.'};
  const search = makeRetriever({chunks:[identity, organization]}, 'Daon', ['다온']);
  assert.equal(search('다온테크')[0]?.id, 'org');
});
