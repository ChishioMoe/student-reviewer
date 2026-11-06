const KEY = "math-review.v1";
const MAX_ATTEMPTS = 30;

export function cleanNickname(value) {
  const text = String(value ?? "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, 16);
  return text || "同学";
}

function emptyStore() {
  return { nickname: "同学", attempts: [] };
}

function validAttempt(attempt) {
  return Boolean(
    attempt &&
      typeof attempt.id === "string" &&
      typeof attempt.paperId === "string" &&
      Array.isArray(attempt.items) &&
      Number.isFinite(attempt.score) &&
      Number.isFinite(attempt.total),
  );
}

export function loadStore() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyStore();
    const data = JSON.parse(raw);
    const attempts = Array.isArray(data.attempts) ? data.attempts.filter(validAttempt).slice(-MAX_ATTEMPTS) : [];
    return { nickname: cleanNickname(data.nickname), attempts };
  } catch {
    return { ...emptyStore(), unavailable: true };
  }
}

export function saveStore(data) {
  const next = {
    nickname: cleanNickname(data.nickname),
    attempts: data.attempts.slice(-MAX_ATTEMPTS),
  };
  localStorage.setItem(KEY, JSON.stringify(next));
  return next;
}

export function upsertAttempt(attempt) {
  const data = loadStore();
  const index = data.attempts.findIndex((item) => item.id === attempt.id);
  if (index >= 0) data.attempts[index] = attempt;
  else data.attempts.push(attempt);
  return saveStore(data);
}

export function markPractice(attemptId, problemId, correct) {
  const data = loadStore();
  const attempt = data.attempts.find((item) => item.id === attemptId);
  const row = attempt?.practice?.find((item) => item.id === problemId);
  if (!row || row.checked) return data;
  row.checked = true;
  row.correct = Boolean(correct);
  return saveStore(data);
}

export function clearStore() {
  localStorage.removeItem(KEY);
  return emptyStore();
}
