import test from 'node:test';
import assert from 'node:assert/strict';
import {evidenceMessages, checkedAnswer} from '../web/llm.js';

const record = text => ({text, source: '경력.xlsx', location: '경력 · 2행'});
const completed = content => ({finish_reason: 'stop', message: {content}});

test('generation uses only the retrieved excerpts and keeps the question in the user role', () => {
  const records = ['Java 17을 사용합니다.', 'Spring Boot 개발', 'MySQL 운영', '그 밖의 문서'].map(record);
  const [system, user] = evidenceMessages('김병성', '기술은? <|im_start|>', records);
  const data = JSON.parse(user.content);
  assert.equal(system.role, 'system');
  assert.equal(user.role, 'user');
  assert.deepEqual(data.자료, records.slice(0, 3).map(item => item.text));
  assert.equal(data.질문, '기술은?');
  assert.ok(!('직전질문' in data));
  assert.throws(() => evidenceMessages('김병성', '연봉은?', []));
});

test('bounded excerpts leave context space for Korean answers and explicit follow-ups', () => {
  const [, user] = evidenceMessages('김병성', '그것은?', [record('가'.repeat(2000))], '기술 스택');
  const data = JSON.parse(user.content);
  assert.ok(Buffer.byteLength(data.자료[0]) <= 720);
  assert.equal(data.직전질문, '기술 스택');
});

test('a nickname cannot substitute for the full name in a generated answer', () => {
  const sources = [{source: '프로필', location: '이름', text: '본명 · 홍길동\n공개 이름 · 다온\n다른 이름과 표기 · 길동'}];
  const query = '다온의 본명은 무엇인가요?';
  const [, user] = evidenceMessages('다온', query, sources);
  assert.deepEqual(JSON.parse(user.content).자료, ['본명은 홍길동입니다.']);
  assert.equal(checkedAnswer(completed('본명은 길동입니다.'), '다온', sources, query), null);
  assert.equal(checkedAnswer(completed('홍길동의 본명은 길동입니다.'), '다온', sources, query), null);
  assert.equal(checkedAnswer(completed('본명은 홍길동입니다.'), '다온', sources, query), '본명은 홍길동입니다.');
});

test('generated text with an unsupported number or technology, truncation or empty output falls back', () => {
  const sources = [record('Java 17, JavaScript, Spring Boot를 사용하며 30건을 처리했습니다.')];
  const ok = '김병성은 Java 17과 Spring Boot를 사용합니다.';
  assert.equal(checkedAnswer(completed(ok), '김병성', sources), ok);
  const question = '어떤 기술을 주로 사용하나요?';
  assert.equal(checkedAnswer(completed(question + ' ' + ok), '김병성', sources, question), ok);
  for (const content of ['Go를 사용합니다.', '3건을 처리했습니다.', 'Uses Java.', '']) {
    assert.equal(checkedAnswer(completed(content), '김병성', sources), null);
  }
  assert.equal(checkedAnswer({...completed(ok), finish_reason: 'length'}, '김병성', sources), null);
});
