// One tab-scoped draft. No localStorage, network autosave, question objects,
// grading answers, or account/contact fields are persisted.
export const ASSESSMENT_DRAFT_KEY = 'fsp.assessment-draft.v1';
export const MAX_DRAFT_ANSWER_LENGTH = 500;
const MAX_RECORD_LENGTH = 64000;
const unavailable = 'Не удалось сохранить ответы в этой вкладке. Они останутся в форме, но могут потеряться при обновлении. Не закрывайте страницу.';
const saved = 'Ответы сохранены в этой вкладке до завершения теста. Выход или смена профиля удаляют черновик. После закрытия вкладки восстановление не гарантируется.';
const browserStorage = () => window.sessionStorage;

/** @param {() => Storage} [getStorage] */
export function clearAssessmentDraft(getStorage = browserStorage) {
  try { getStorage().removeItem(ASSESSMENT_DRAFT_KEY); return true; }
  catch {
    // If removal alone fails, an empty tombstone still prevents restoration.
    try { getStorage().setItem(ASSESSMENT_DRAFT_KEY, ''); return true; } catch { return false; }
  }
}

/** @param {string} api @param {import('./types').WorkspaceData} data @param {number} now */
function bindingFor(api, data, now) {
  const test = data.test;
  const expiresAt = Math.min(test?.expiresAt ?? 0, data.guest?.expiresAt ?? Infinity);
  if (!['/api', '/api/guest', '/api/account', '/api/public-account'].includes(api) || data.user?.role !== 'candidate' || !data.user.verified ||
      !/^[a-f0-9]{64}$/.test(data.draftIdentity || '') || !test?.id || !data.user.id ||
      !Number.isFinite(expiresAt) || expiresAt <= now || !test.questions?.length) return null;
  const ids = test.questions.map(q => q.id);
  if (new Set(ids).size !== ids.length || ids.some(id => typeof id !== 'string' || !id || ['__proto__', 'constructor', 'prototype'].includes(id))) return null;
  // Explicit public-field allowlist: never serialize the complete test/question.
  const scope = JSON.stringify([api, data.draftIdentity, data.user.id, test.id, expiresAt, test.specialization, test.grade,
    test.questions.map(q => [q.id, q.text, q.skill, q.format || 'text', !!q.caseSensitive, q.choices || null])]);
  return {scope, expiresAt, questions: test.questions};
}

/** @param {unknown} input @param {import('./types').Question[]} questions */
function validAnswers(input, questions) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const entries = Object.entries(input);
  if (entries.length > questions.length) return null;
  for (const [id, value] of entries) {
    const question = questions.find(q => q.id === id);
    if (!question || typeof value !== 'string' || value.length > MAX_DRAFT_ANSWER_LENGTH ||
        (value && question.choices && !question.choices.includes(value))) return null;
  }
  return Object.fromEntries(entries);
}

/** @param {() => Storage} [getStorage] */
export function createAssessmentDraftStore(getStorage = browserStorage) {
  /** @type {ReturnType<typeof bindingFor>} */
  let binding = null;
  /** @type {Record<string, string>} */
  let answers = {};
  let message = '';
  const result = () => ({answers: {...answers}, active: !!binding, message});
  function clear() {
    binding = null;
    answers = {};
    message = '';
    return clearAssessmentDraft(getStorage);
  }
  function persist() {
    if (!binding) return result();
    try {
      const serialized = JSON.stringify({version: 1, scope: binding.scope, answers});
      if (serialized.length > MAX_RECORD_LENGTH) throw new Error('Draft too large');
      getStorage().setItem(ASSESSMENT_DRAFT_KEY, serialized);
      message = saved;
    } catch {
      // Never restore an older value after a failed write. Keep the current
      // answers in memory so quota/security errors do not break the form.
      clearAssessmentDraft(getStorage);
      message = unavailable;
    }
    return result();
  }
  return {
    clear,
    /** Restore only after an authoritative state response, never before login.
     * @param {string} api @param {import('./types').WorkspaceData} data @param {number} [now] */
    reconcile(api, data, now = Date.now()) {
      const next = bindingFor(api, data, now);
      if (!next) { clear(); return result(); }
      // A background refresh must not replace newer in-memory edits.
      if (binding?.scope === next.scope) return result();
      binding = next;
      answers = {};
      let restored = false;
      try {
        const raw = getStorage().getItem(ASSESSMENT_DRAFT_KEY);
        if (raw && raw.length <= MAX_RECORD_LENGTH) {
          const record = JSON.parse(raw);
          const valid = record?.version === 1 && record.scope === next.scope ? validAnswers(record.answers, next.questions) : null;
          if (valid) { answers = valid; restored = Object.keys(valid).length > 0; }
        }
      } catch { /* Corrupt or unavailable storage is never trusted. */ }
      clearAssessmentDraft(getStorage);
      const current = persist();
      return {...current, message: restored && message === saved ? `Ответы восстановлены. ${saved}` : message};
    },
    /** @param {string} id @param {string} value @param {number} [now] */
    update(id, value, now = Date.now()) {
      if (!binding || binding.expiresAt <= now) { clear(); return result(); }
      const next = validAnswers({...answers, [id]: value}, binding.questions);
      if (!next) return result();
      answers = next;
      return persist();
    },
  };
}
