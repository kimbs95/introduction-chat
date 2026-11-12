// 공개 자료의 한국어·영어 키워드를 브라우저에서 검색한다.
// 임베딩 모델 없이 동작하므로 복잡한 의미 검색에는 한계가 있다.
const STOP = new Set(['어떤','어떻게','무엇','뭐야','누구','얼마','정도','지금','대한','대해','대해서','가장','사용','있나요','하나요','인가요','알려줘','알려주세요','알려','궁금해요','주세요','설명해줘','해줘','개발자','좀','the','is','a','an','what','how','about','your','you','tell','me']);
const GROUPS = [
  { pattern: /기술|스택|언어|skills?|stack/i, terms: ['기술','스택','java','spring','mysql','docker','linux','javascript','react'] },
  { pattern: /데브옵스|devops|데브.?옵스/i, terms: ['devops','운영','배포','학습','자동화'] },
  { pattern: /목표|앞으로|장기|계획|goal|future/i, terms: ['목표','장기','성장','시니어'] },
  { pattern: /자기소개|소개해|누구|어떤\s*(사람|개발자|분)|introduc|yourself/i, terms: ['소개','역할','백엔드'] },
  { pattern: /본명|실명|성함|닉네임|별명|별칭|영문명|한글명|뭐라고\s*불러|\b(?:name|nickname|aliases)\b/i, terms: ['본명','공개 이름','다른 이름과 표기'] },
  { pattern: /데이터베이스|\bdb\b|database/i, terms: ['데이터베이스','mysql','sql','oracle','postgresql'] },
  { pattern: /배포|자동화|파이프라인|ci\/?cd/i, terms: ['배포','자동화','ci/cd','파이프라인','docker'] },
  { pattern: /클라우드|cloud/i, terms: ['클라우드','cloud','aws','gcp'] },
  { pattern: /스프링/i, terms: ['spring'] },
  { pattern: /자바(?!스크립트)/i, terms: ['java'] },
  { pattern: /도커/i, terms: ['docker'] },
  { pattern: /쿠버네티스/i, terms: ['kubernetes'] },
  { pattern: /리눅스/i, terms: ['linux'] },
];
const REQUIRED_INTENTS = [
  { question: /프로젝트|프로젝|project/i, evidence: /프로젝트|프로젝|project/i },
  { question: /연봉|급여|salary/i, evidence: /연봉|급여|salary/i },
  { question: /몇\s*년|경력\s*연수|몇\s*개월|years? of experience/i, evidence: /\d+\s*(년|개월)|경력\s*(연수|기간)|years? of experience/i },
  { question: /학교|학력|전공|졸업|education/i, evidence: /학교|학력|전공|졸업|education/i },
  { question: /자격증|certification/i, evidence: /자격증|자격|certification/i },
  { question: /회사|재직|근무|어디서.*일|employer/i, evidence: /회사|재직|근무|employer/i },
  { question: /이메일|메일|연락|email|contact/i, evidence: /이메일|메일|연락|email|contact|@/i },
];
const normalize = value => value.normalize('NFKC').toLowerCase();

function tokens(value) {
  return [...new Set((normalize(value).match(/[a-z][a-z0-9+#./-]*|[가-힣]{2,}|\d+/g) || [])
    .filter(word => !STOP.has(word))
    .map(word => word.replace(/(인가요|하나요|했나요|있나요|해요|나요|은|는|을|를|이|가|에|의|도|로)$/, ''))
    .filter(word => word.length > 1 && !STOP.has(word)))];
}

function features(word) {
  const parts = [word];
  if (/^[가-힣]{3,}$/.test(word)) {
    for (let i = 0; i < word.length - 1; i++) parts.push(word.slice(i, i + 2));
  }
  return [...new Set(parts)];
}

function profileNamePattern(names) {
  const variants = [...new Set(names.filter(Boolean).map(name => normalize(name.trim())))].filter(Boolean);
  if (!variants.length) return null;
  const alternatives = variants.sort((a, b) => b.length - a.length)
    .map(name => name.replace(/[$.*+?^{}()|[\]\\]/g, '\\$&')).join('|');
  // "병성님은"을 주어로 인식하되, 더 긴 고유 명사의 일부는 그대로 검색한다.
  const suffix = '(?:이랑|랑|하고|에게|께서|인가요|이에요|예요|이야|야|이죠|이가|은|는|이|가|의|과|와|도|을|를)?';
  return new RegExp('(^|[^\\p{L}\\p{N}])(?:' + alternatives +
    ')(?:\\s*(?:님|씨))?' + suffix + '(?=$|[^\\p{L}\\p{N}])', 'gu');
}

export function makeRetriever(knowledge, profileName = '', aliases = []) {
  const namePattern = profileNamePattern([profileName, ...aliases]);
  const identity = knowledge.chunks.find(chunk => chunk.source === '프로필' && chunk.location === '이름');
  const records = knowledge.chunks
    .filter(chunk => !/^#{1,6}\s+[^\n]+$/.test(chunk.text.trim()))
    .map(chunk => ({...chunk, normalized: normalize(chunk.text)}));
  return (question, history = []) => {
    let query = question.trim();
    // 직전 답변을 사실로 재사용하지 않고, 명시적인 후속 질문에만 이전 질문의 검색어를 보탠다.
    if (/^(그(것|거|런|쪽)|이어서|좀 더|더 자세|그럼|그러면)/.test(query)) {
      const previous = [...history].reverse().find(m => m.role === 'user');
      if (previous) query = `${previous.content.slice(0, 300)} ${query}`;
    }
    const normalized = normalize(query);
    const topic = namePattern ? normalized.replace(namePattern, '$1 ') : normalized;
    const remaining = topic.replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    const identityCheck = /^(?:같은\s*(?:사람|분)|동일인)(?:이야|인가요|입니까|이에요|예요|이죠|이?\s*맞나요)?$/;
    if (identity && topic !== normalized && (!remaining || identityCheck.test(remaining))) {
      return [identity];
    }
    const base = tokens(topic);
    const expansion = GROUPS.filter(group => group.pattern.test(topic)).flatMap(group => group.terms);
    const weights = new Map();
    for (const word of base) for (const token of features(word)) weights.set(token, token === word ? 3 : 0.45);
    for (const word of expansion) if (!weights.has(word)) weights.set(word, 1.3);
    const intents = REQUIRED_INTENTS.filter(intent => intent.question.test(question));
    const candidates = records.filter(record => intents.every(intent => intent.evidence.test(record.text)));
    const frequencies = new Map([...weights.keys()].map(term => [term, records.filter(r => r.normalized.includes(term)).length]));
    const scored = candidates.map(record => {
      let score = 0, exact = 0;
      for (const [term, weight] of weights) {
        if (!record.normalized.includes(term)) continue;
        const frequency = frequencies.get(term);
        score += weight * (1 + Math.log(1 + records.length / (1 + frequency)));
        if (weight >= 1.3) exact++;
      }
      score /= 1 + record.text.length / 1500;
      return {...record, score, exact};
    }).filter(record => record.score >= 2 && record.exact > 0).sort((a, b) => b.score - a.score);
    const selected = [];
    for (const record of scored) {
      if (selected.some(other => other.text === record.text)) continue;
      if (selected.length && record.score < scored[0].score * 0.28) continue;
      const {normalized, score, exact, ...chunk} = record;
      selected.push(chunk);
      if (selected.length === 4) break;
    }
    return selected;
  };
}

export function extractiveAnswer(sources) {
  if (!sources.length) return '공개된 자료에서 이 질문에 대한 근거를 찾지 못했어요. 기술 스택이나 관심 분야처럼 구체적인 단어로 질문해 보세요. 등록되지 않은 경력이나 성과는 추측하지 않습니다.';
  return '공개 자료에서 찾은 관련 내용이에요.\n\n' + sources.slice(0, 3)
    .map((source, i) => `[${i + 1}] ${source.text.replace(/^#{1,6}\s+/gm, '')}`).join('\n\n');
}
