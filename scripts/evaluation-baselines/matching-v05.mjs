// Explicit lexical requirements and inspectable weights; no hidden FSP boost.
export const SKILL_ALIASES = {
  Python: ['python', 'питон', 'питоне', 'питона', 'пайтон', 'пайтоне'], SQL: ['sql'], TypeScript: ['typescript', 'тайпскрипт'], React: ['react', 'react.js', 'reactjs', 'реакт', 'реакте', 'реакта'],
  CSS: ['css'], Accessibility: ['accessibility', 'a11y', 'доступность'], HTTP: ['http', 'rest', 'api'], Algorithms: ['алгоритмы', 'алгоритмов', 'алгоритмами', 'algorithms'],
  Docker: ['docker', 'докер'], Kubernetes: ['kubernetes', 'k8s'], 'Node.js': ['node.js', 'nodejs'], JavaScript: ['javascript'],
  Java: ['java'], Go: ['golang', 'go'], PostgreSQL: ['postgresql', 'postgres'], Kotlin: ['kotlin'],
};
const specs = { Backend: ['backend', 'back-end', 'бэкенд', 'бекенд', 'бекэнд', 'бэкендер', 'бэкендера', 'бэкенде', 'бэкенду'], Frontend: ['frontend', 'front-end', 'фронтенд', 'фронтэнд', 'фронтендер', 'фронтендера', 'фронтенде'] };
const levels = { Junior: ['junior', 'джуниор', 'джун', 'джуна', 'джуниора', 'начинающий', 'начинающего'], Middle: ['middle', 'мидл', 'мидла', 'мидлу', 'миддл', 'миддла'], Senior: ['senior', 'сеньор', 'синьор', 'сеньора', 'синьора', 'старший', 'старшего'] };
const words = text => String(text || '').toLowerCase().replace(/ё/g, 'е').replace(/(back|front)-end/g, '$1end').split(/[^\p{L}\p{N}.+#]+/u).map(token=>token.replace(/^\.+|\.+$/g,'')).filter(Boolean);
const includesAlias = (tokens, aliases) => aliases.some(alias => tokens.includes(alias));
const recognized = (catalog, tokens) => Object.entries(catalog).filter(([, aliases]) => includesAlias(tokens, aliases)).map(([key]) => key);
const negativePrefixes = ['без', 'not', 'no', 'не', 'исключить', 'не нужен', 'не нужна', 'не требуется', 'не требуются', 'не использовать'];
const negativeSuffixes = ['не нужен', 'не нужна', 'не нужно', 'не нужны', 'не требуется', 'не требуются'];
const optionalPrefixes = ['необязательно', 'не обязательно', 'желательно', 'желателен', 'желательна', 'приветствуется', 'приветствуются', 'опционально', 'будет плюсом', 'nice to have', 'optional'];
const optionalSuffixes = [...optionalPrefixes, 'необязателен', 'необязательна', 'необязательно', 'необязательны', 'не обязателен', 'не обязательна', 'не обязательно', 'не обязательны'];
const sameAt = (tokens, start, phrase) => phrase.every((word,index) => tokens[start+index]===word);
const knownWords = new Set([...Object.values(specs).flat(),...Object.values(levels).flat(),...Object.values(SKILL_ALIASES).flat()]);
const startsWithPhrase = (tokens, phrases) => phrases.some(phrase => { const p=words(phrase); return sameAt(tokens,0,p)&&!knownWords.has(tokens[p.length]); });
const listWords = new Set(['и','или','and','or','знание','знания','опыт','опыта','использование','использования',...Object.values(SKILL_ALIASES).flat()]);
function prefixed(tokens, index, phrases) {
  for (let start=Math.max(0,index-8); start<index; start++) for (const phrase of phrases) {
    const p=words(phrase); if(start+p.length>index||!sameAt(tokens,start,p))continue;
    const between=tokens.slice(start+p.length,index);
    if(between.every(token=>listWords.has(token)))return true;
  }
  return false;
}
// Bounded phrase handling, not semantic NLP: classify only known local patterns.
function mentions(catalog, text) {
  const result=[];
  for (const clause of text.split(/[;,\n!?]+|\.(?=\s|$)/u)) {
    const tokens=words(clause), found=[];
    for(const [value,aliases] of Object.entries(catalog))for(let index=0;index<tokens.length;index++)if(aliases.includes(tokens[index])) {
      const after=tokens.slice(index+1);
      const optional=startsWithPhrase(after,optionalSuffixes)||prefixed(tokens,index,optionalPrefixes);
      const excluded=!optional&&(startsWithPhrase(after,negativeSuffixes)||prefixed(tokens,index,negativePrefixes));
      found.push({value,kind:optional?'optional':excluded?'excluded':'positive'});
    }
    const alternatives=tokens.some(token=>token==='или'||token==='or')&&new Set(found.filter(x=>x.kind==='positive').map(x=>x.value)).size>1;
    result.push(...found.map(item=>alternatives&&item.kind==='positive'?{...item,kind:'alternative'}:item));
  }
  return result;
}
export function parseRequirements(filters = {}) {
  const text = String(filters.need || '');
  const specMentions=mentions(specs,text), gradeMentions=mentions(levels,text), skillMentions=mentions(SKILL_ALIASES,text);
  const positives=items=>[...new Set(items.filter(item=>item.kind==='positive').map(item=>item.value))];
  const detectedSpecs=positives(specMentions),detectedGrades=positives(gradeMentions);
  const explicitSkills = String(filters.skills || '').split(/[,;]+/).map(value => value.trim()).filter(Boolean).map(value => recognized(SKILL_ALIASES, [value.toLowerCase()])[0] || value);
  const skills = [...new Set([...positives(skillMentions), ...explicitSkills])];
  const minimums=[...text.matchAll(/(?:от|не менее|не меньше|минимум|at least)\s*(\d{1,2}(?:[.,]\d{1,2})?)\s*(?:лет|года|год|years?)/gi)].map(match=>Number(match[1].replace(',','.')));
  const range=text.match(/от\s*(\d{1,2})\s*до\s*(\d{1,2})\s*(?:лет|года|год)/i);
  const plus=text.match(/(?:опыт\s*)?(\d{1,2})\+\s*(?:лет|года|год|years?)/i);
  if(range)minimums.push(Number(range[1])); if(plus)minimums.push(Number(plus[1]));
  let minExperience=minimums.length&&new Set(minimums).size===1?minimums[0]:null;
  const maximum=text.match(/(?:не более|максимум|at most)\s*(\d{1,2})\s*(?:лет|года|год|years?)/i);
  const specialization = filters.specialization || (detectedSpecs.length === 1 ? detectedSpecs[0] : '');
  const grade = filters.grade || (detectedGrades.length === 1 ? detectedGrades[0] : '');
  const warnings = ['Распознаётся ограниченный словарь и простые формулировки. Прочие условия нужно проверить вручную.'];
  if (detectedSpecs.length > 1 || detectedGrades.length > 1) warnings.push('В тексте несколько специализаций или грейдов: выберите нужный фильтр.');
  if (filters.specialization && (detectedSpecs.some(value => value !== filters.specialization)||specMentions.some(x=>x.value===filters.specialization&&x.kind!=='positive'))) warnings.push('Фильтр специализации имеет приоритет над текстом.');
  if (filters.grade && (detectedGrades.some(value => value !== filters.grade)||gradeMentions.some(x=>x.value===filters.grade&&x.kind!=='positive'))) warnings.push('Фильтр грейда имеет приоритет над текстом.');
  const excluded=[...new Set([...specMentions,...gradeMentions,...skillMentions].filter(x=>x.kind==='excluded').map(x=>x.value))];
  const optional=[...new Set([...specMentions,...gradeMentions,...skillMentions].filter(x=>x.kind==='optional').map(x=>x.value))];
  const alternatives=[...new Set([...specMentions,...gradeMentions,...skillMentions].filter(x=>x.kind==='alternative').map(x=>x.value))];
  if(excluded.length)warnings.push(`Отрицание не даёт положительного балла: ${excluded.join(', ')}. Это не фильтр исключения кандидатов; проверьте условие вручную.`);
  if(optional.length)warnings.push(`Необязательные условия не влияют на балл: ${optional.join(', ')}.`);
  if(alternatives.length)warnings.push(`Альтернативы не объединяются в обязательный стек и не влияют на балл: ${alternatives.join(', ')}. Уточните фильтры.`);
  if(explicitSkills.some(skill=>[...excluded,...optional,...alternatives].includes(skill)))warnings.push('Явный фильтр стека имеет приоритет над отрицанием, альтернативой или необязательностью в тексте.');
  if(new Set(minimums).size>1){minExperience=null;warnings.push('Несколько разных требований к стажу: общий минимум не определён, нужна ручная проверка.');}
  if(range||maximum)warnings.push('Верхняя граница стажа автоматически не применяется. Проверьте её вручную.');
  if((range&&Number(range[1])>Number(range[2]))||(maximum&&minExperience!==null&&minExperience>Number(maximum[1]))){minExperience=null;warnings.push('Противоречивые границы стажа: опыт не влияет на балл до уточнения.');}
  if(/не\s+только|not\s+only|middle\+|мидл\+/i.test(text))warnings.push('Сложная формулировка или диапазон грейда требует ручной проверки.');
  return { specialization, grade, skills, explicitSkills, minExperience, warnings, source: { specialization: filters.specialization ? 'filter' : 'text', grade: filters.grade ? 'filter' : 'text' } };
}
export function matchCandidate(candidate, requirements) {
  const confirmed = candidate.skills || [];
  const components = [], missing = [];
  const add = (key, label, weight, fit) => components.push({ key, label, weight, fit });
  if (requirements.specialization) { const fit = candidate.specialization === requirements.specialization ? 1 : 0; add('specialization', `Специализация ${requirements.specialization}`, 25, fit); if (!fit) missing.push(requirements.specialization); }
  if (requirements.grade) { const fit = candidate.grade === requirements.grade ? 1 : 0; add('grade', `Грейд ${requirements.grade}`, 20, fit); if (!fit) missing.push(`грейд ${requirements.grade}`); }
  if (requirements.skills.length) { const found = requirements.skills.filter(skill => confirmed.some(value => value.toLowerCase() === skill.toLowerCase())); add('skills', `Подтверждённый стек ${found.length}/${requirements.skills.length}`, 45, found.length / requirements.skills.length); missing.push(...requirements.skills.filter(skill => !found.includes(skill))); }
  if (requirements.minExperience !== null) { const experience = Number.isFinite(Number(candidate.experience)) ? Math.max(0,Number(candidate.experience)) : 0; const fit = requirements.minExperience === 0 ? 1 : Math.min(1, experience / Math.max(1, requirements.minExperience)); add('experience', `Опыт от ${requirements.minExperience} лет (самоописание)`, 10, fit); if (fit < 1) missing.push(`опыт от ${requirements.minExperience} лет`); }
  const weight = components.reduce((sum, item) => sum + item.weight, 0);
  const relevance = weight ? components.reduce((sum, item) => sum + item.weight * item.fit, 0) / weight * 100 : null;
  const score = Math.max(0, Math.min(100, Number(candidate.score) || 0));
  const match = Math.round(relevance === null ? score : relevance * 0.8 + score * 0.2);
  const reasons = components.map(item => `${item.label}: ${Math.round(item.fit * 100)}% соответствия · вес ${Math.round(item.weight / weight * 80)}%`);
  reasons.push(`Тест: ${score}/100 · вес ${relevance === null ? 100 : 20}%${candidate.evidenceSource === 'synthetic_seed' ? ' · исходная синтетика' : ''}`);
  reasons.push('ФСП: только фильтр; бонус к рейтингу не начисляется');
  return { match, relevance: relevance === null ? null : Math.round(relevance), missing, reasons, components };
}
