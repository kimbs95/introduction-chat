import test from 'node:test';
import assert from 'node:assert/strict';
import {knowledge} from './fixtures.js';
import {makeRetriever, extractiveAnswer} from '../web/search.js';

const retrieve = makeRetriever(knowledge, 'Raon');
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
  assert.deepEqual(retrieve('Raon의 취미는 뭔가요?'), []);
  assert.deepEqual(retrieve('Raon의 연봉은 얼마인가요?'), []);
});

test('an introduction question returns body text rather than a bare heading', () => {
  const search = makeRetriever({chunks: [
    ...knowledge.chunks, {id:'heading', documentId:'a', source:'소개.md', location:'1문단', text:'# Raon 소개'}
  ]}, 'Raon');
  const found = search('Raon은 어떤 개발자인가요?');
  assert.ok(found.some(item => item.id === 'intro'));
  assert.ok(found.every(item => item.id !== 'heading'));
});
