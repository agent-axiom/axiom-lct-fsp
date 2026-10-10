// Explicit lexical requirements, inspectable weights, and bounded DEMO evidence.
import {achievementBonus} from './achievements.mjs';
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
// Support only a local two-skill OR, never silently turn complex lists into AND.
function alternativeSkillGroups(text) {
 const groups=[];
 for(const clause of text.split(/[;,\n!?]+|\.(?=\s|$)/u)) {
  const tokens=words(clause),joins=tokens.map((token,index)=>['or','или'].includes(token)?index:-1).filter(index=>index>=0);
  if(joins.length!==1)continue;
  const index=joins[0],left=recognized(SKILL_ALIASES,[tokens[index-1]]),right=recognized(SKILL_ALIASES,[tokens[index+1]]);
  const found=mentions(SKILL_ALIASES,clause);
  if(left.length===1&&right.length===1&&left[0]!==right[0]&&new Set(found.map(item=>item.value)).size===2&&found.every(item=>item.kind==='alternative'))groups.push([left[0],right[0]]);
 }
 return groups.filter((group,index)=>groups.findIndex(other=>other.join('|')===group.join('|'))===index);
}
// Fail closed for explicit must-have clauses outside the bounded vocabulary.
// Preserve the original clause for review; never fabricate a measured skill.
const mandatoryWords = new Set(['обязателен','обязательна','обязательно','обязательны','обязательное','обязательные','обязательный','требуется','требуются','required','mandatory','must']);
const requirementGlue = new Set(['и','или','and','or','знание','знания','знать','опыт','опыта','работы','с','со','в','на','по','от','не','менее','меньше','минимум','лет','года','год','years','year','at','least','have','be','is','are','to','требование','требования',...mandatoryWords]);
function unverifiedMandatoryClauses(text) {
 const result=[];
 for(const sentence of text.split(/[;\n!?]+|\.(?=\s|$)/u)) {
  let inheritedMandatory=false;
  for(const clause of sentence.split(',')) {
   const tokens=words(clause);
   const explicitMandatory=tokens.some((token,index)=>mandatoryWords.has(token)&&!['не','not','no'].includes(tokens[index-1]));
   // Reuse local negative/optional scope rules for comma-list inheritance,
   // including suffixes: an optional Rust clause must not inherit Python's must.
   const softened=tokens.some((token,index)=>['не','not','no'].includes(token)&&mandatoryWords.has(tokens[index+1]))||tokens.some((token,index)=>!requirementGlue.has(token)&&(
    startsWithPhrase(tokens.slice(index+1),[...optionalSuffixes,...negativeSuffixes,'not needed','not required'])||
    prefixed(tokens,index,[...optionalPrefixes,...negativePrefixes])
   ));
   const mandatory=explicitMandatory||(!softened&&inheritedMandatory);
   inheritedMandatory=mandatory;
   if(!mandatory)continue;
   const unknown=tokens.filter(token=>!knownWords.has(token)&&!requirementGlue.has(token)&&!/^\d+(?:\.\d+)?$/.test(token));
   if(unknown.length)result.push(clause.trim());
  }
 }
 return [...new Set(result)];
}
export function parseRequirements(filters = {}) {
  const text = String(filters.need || '');
  const skillGroups=alternativeSkillGroups(text);
  const unverifiedRequirements=unverifiedMandatoryClauses(text);
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
  if(unverifiedRequirements.length)warnings.push(`Обязательные условия не поддерживаются автоматической проверкой: ${unverifiedRequirements.join('; ')}. Полное соответствие не подтверждено; бонус ФСП не начисляется.`);
  if (detectedSpecs.length > 1 || detectedGrades.length > 1) warnings.push('В тексте несколько специализаций или грейдов: выберите нужный фильтр.');
  if (filters.specialization && (detectedSpecs.some(value => value !== filters.specialization)||specMentions.some(x=>x.value===filters.specialization&&x.kind!=='positive'))) warnings.push('Фильтр специализации имеет приоритет над текстом.');
  if (filters.grade && (detectedGrades.some(value => value !== filters.grade)||gradeMentions.some(x=>x.value===filters.grade&&x.kind!=='positive'))) warnings.push('Фильтр грейда имеет приоритет над текстом.');
  const excluded=[...new Set([...specMentions,...gradeMentions,...skillMentions].filter(x=>x.kind==='excluded').map(x=>x.value))];
  const optional=[...new Set([...specMentions,...gradeMentions,...skillMentions].filter(x=>x.kind==='optional').map(x=>x.value))];
  const alternatives=[...new Set([...specMentions,...gradeMentions,...skillMentions].filter(x=>x.kind==='alternative').map(x=>x.value))];
  if(excluded.length)warnings.push(`Отрицание не даёт положительного балла: ${excluded.join(', ')}. Это не фильтр исключения кандидатов; проверьте условие вручную.`);
  if(optional.length)warnings.push(`Необязательные условия не влияют на балл: ${optional.join(', ')}.`);
  const handledAlternatives=new Set(skillGroups.flat()),unresolvedAlternatives=alternatives.filter(value=>!handledAlternatives.has(value));
  if(skillGroups.length)warnings.push(`Альтернативы стека: ${skillGroups.map(group=>group.join(' или ')).join('; ')}. Достаточно одного подтверждённого навыка из каждой пары.`);
  if(unresolvedAlternatives.length)warnings.push(`Сложные альтернативы не объединяются в обязательный стек и не влияют на балл: ${unresolvedAlternatives.join(', ')}. Уточните фильтры.`);
  if(explicitSkills.some(skill=>[...excluded,...optional,...alternatives].includes(skill)))warnings.push('Явный фильтр стека имеет приоритет над отрицанием, альтернативой или необязательностью в тексте.');
  if(new Set(minimums).size>1){minExperience=null;warnings.push('Несколько разных требований к стажу: общий минимум не определён, нужна ручная проверка.');}
  if(range||maximum)warnings.push('Верхняя граница стажа автоматически не применяется. Проверьте её вручную.');
  if((range&&Number(range[1])>Number(range[2]))||(maximum&&minExperience!==null&&minExperience>Number(maximum[1]))){minExperience=null;warnings.push('Противоречивые границы стажа: опыт не влияет на балл до уточнения.');}
  if(/не\s+только|not\s+only|middle\+|мидл\+/i.test(text))warnings.push('Сложная формулировка или диапазон грейда требует ручной проверки.');
  return { specialization, grade, skills, skillGroups, explicitSkills, minExperience, unverifiedRequirements, warnings, source: { specialization: filters.specialization ? 'filter' : 'text', grade: filters.grade ? 'filter' : 'text' } };
}
export function matchCandidate(candidate, requirements) {
  const confirmed = candidate.skills || [];
  const unverifiedRequirements=requirements.unverifiedRequirements||[];
  const components = [], missing = unverifiedRequirements.map(clause=>`не проверено: ${clause}`);
  const add = (key, label, weight, fit) => components.push({ key, label, weight, fit });
  if (requirements.specialization) { const fit = candidate.specialization === requirements.specialization ? 1 : 0; add('specialization', `Специализация ${requirements.specialization}`, 25, fit); if (!fit) missing.push(requirements.specialization); }
  if (requirements.grade) { const fit = candidate.grade === requirements.grade ? 1 : 0; add('grade', `Грейд ${requirements.grade}`, 20, fit); if (!fit) missing.push(`грейд ${requirements.grade}`); }
  const groups=requirements.skillGroups||[];
  if (requirements.skills.length||groups.length) { const has=skill=>confirmed.some(value=>value.toLowerCase()===skill.toLowerCase()); const found=requirements.skills.filter(has),foundGroups=groups.filter(group=>group.some(has)); const total=requirements.skills.length+groups.length; add('skills', `Подтверждённый стек ${found.length+foundGroups.length}/${total}${groups.length?' (OR-пара = одно условие)':''}`, 45, (found.length+foundGroups.length)/total); missing.push(...requirements.skills.filter(skill=>!found.includes(skill)),...groups.filter(group=>!group.some(has)).map(group=>`один из ${group.join(' / ')}`)); }
  if (requirements.minExperience !== null) { const experience = Number.isFinite(Number(candidate.experience)) ? Math.max(0,Number(candidate.experience)) : 0; const fit = requirements.minExperience === 0 ? 1 : Math.min(1, experience / Math.max(1, requirements.minExperience)); add('experience', `Опыт от ${requirements.minExperience} лет (самоописание)`, 10, fit); if (fit < 1) missing.push(`опыт от ${requirements.minExperience} лет`); }
  if(unverifiedRequirements.length)add('unverified', 'Обязательные условия не проверены (это не подтверждение отсутствия навыка)', 45, 0);
  const weight = components.reduce((sum, item) => sum + item.weight, 0);
  const relevance = weight ? components.reduce((sum, item) => sum + item.weight * item.fit, 0) / weight * 100 : null;
  const score = Math.max(0, Math.min(100, Number(candidate.score) || 0));
  const baseMatch = relevance === null ? score : relevance * 0.8 + score * 0.2;
  const achievement = achievementBonus(candidate,requirements,missing,baseMatch);
  const match = Math.round(baseMatch + achievement.bonus);
  const reasons = components.filter(item=>item.key!=='unverified').map(item => `${item.label}: ${Math.round(item.fit * 100)}% соответствия · вес ${Math.round(item.weight / weight * 80)}%`);
  reasons.push(`Тест: ${score}/100 · вес ${relevance === null ? 100 : 20}%${candidate.evidenceSource === 'synthetic_seed' ? ' · исходная синтетика' : ''}`);
  if(unverifiedRequirements.length)reasons.push(`Полное соответствие не подтверждено. Непроверенный компонент: 0 начисленных баллов · вес ${Math.round(45/weight*80)}%. Нужна ручная проверка: ${unverifiedRequirements.join('; ')}.`);
  reasons.push(achievement.bonus>0?`ФСП · DEMO: +${Number(achievement.bonus.toFixed(2))} из максимум 5 · совпала категория и распознанные требования · синтетический источник, не реестр`:'ФСП · DEMO: +0 · нужны подтверждённое демо-достижение, точная категория в запросе и совпадение распознанных требований без непроверенных обязательных условий');
  return { match, unverifiedRequirements, matchStatus:unverifiedRequirements.length?'unverified':missing.length?'partial':'recognized_match', relevance: relevance === null ? null : Math.round(relevance), missing, reasons, components, achievement };
}
