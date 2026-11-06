import { KNOWLEDGE, PRACTICE } from "./papers.js";

const SEVERITY = {
  计算失误: 0.35,
  步骤遗漏: 0.5,
  符号错误: 0.55,
  审题偏差: 0.8,
  概念混淆: 1,
};

export function normalizeAnswer(raw) {
  let text = String(raw ?? "").trim();
  text = text.replace(/\u3000/g, "").replace(/\s+/g, "");
  text = text.replace(/[０-９Ａ-Ｚａ-ｚ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
  text = text.toLowerCase();
  text = text.replace(/＝/g, "=").replace(/／/g, "/");
  text = text.replace(/[−–—]/g, "-");
  text = text.replace(/度|°/g, "");
  text = text.replace(/[。．]+$/g, "").replace(/\.$/g, "");
  text = text.replace(/(升|元|厘米|cm|本|页|米)$/g, "");
  return text;
}

export function isAccepted(accept, raw) {
  const given = normalizeAnswer(raw);
  if (!given) return false;
  return accept.some((item) => normalizeAnswer(item) === given);
}

export function gradePaper(paper, answers) {
  const items = paper.questions.map((question) => {
    const given = answers[question.id] ?? "";
    const correct = isAccepted(question.accept, given);
    const matchesSample = normalizeAnswer(given) === normalizeAnswer(question.studentAnswer);
    let explanation = question.okNote;
    let errorType = null;
    if (!correct) {
      errorType = matchesSample ? question.errorType : "计算失误";
      explanation = matchesSample
        ? question.sampleMistake
        : `标准答案是 ${question.displayAnswer}。${KNOWLEDGE[question.knowledge].pitfall}`;
    }
    return {
      id: question.id,
      prompt: question.prompt,
      given,
      correct,
      earned: correct ? question.points : 0,
      points: question.points,
      knowledge: question.knowledge,
      errorType,
      explanation,
      displayAnswer: question.displayAnswer,
    };
  });
  const score = items.reduce((sum, item) => sum + item.earned, 0);
  const total = items.reduce((sum, item) => sum + item.points, 0);
  return { items, score, total };
}

export function tipsFor(items) {
  const tips = [];
  const seen = new Set();
  for (const item of items) {
    if (item.correct || seen.has(item.knowledge)) continue;
    seen.add(item.knowledge);
    const meta = KNOWLEDGE[item.knowledge];
    tips.push({
      name: item.knowledge,
      technique: meta.technique,
      pitfall: meta.pitfall,
    });
  }
  return tips;
}

export function buildPractice(items) {
  const weak = [];
  for (const item of items) {
    if (!item.correct && !weak.includes(item.knowledge)) weak.push(item.knowledge);
  }
  const sources = weak.length ? weak : [...new Set(items.map((item) => item.knowledge))];
  const picked = [];
  const used = new Set();
  const take = (knowledge) => {
    const found = PRACTICE.find((problem) => problem.knowledge === knowledge && !used.has(problem.id));
    if (!found) return false;
    used.add(found.id);
    picked.push(found);
    return true;
  };
  let added = true;
  while (picked.length < 3 && added) {
    added = false;
    for (const knowledge of sources) {
      if (picked.length >= 3) break;
      if (take(knowledge)) added = true;
    }
  }
  return picked;
}

export function matchPaperId(fileName, papers) {
  const name = String(fileName || "");
  const lower = name.toLowerCase();
  for (const paper of papers) {
    if (paper.fileHints.some((hint) => lower.includes(hint.toLowerCase()) || name.includes(hint))) {
      return paper.id;
    }
  }
  return null;
}

export function masteryScore(items) {
  const groups = new Map();
  for (const item of items) {
    const group = groups.get(item.knowledge) || { earned: 0, total: 0 };
    group.earned += item.earned;
    group.total += item.points;
    groups.set(item.knowledge, group);
  }
  if (groups.size === 0) return 0;
  let sum = 0;
  for (const group of groups.values()) sum += group.total ? group.earned / group.total : 0;
  return Math.round((100 * sum) / groups.size);
}

export function errorTypeScore(items) {
  const wrongs = items.filter((item) => !item.correct && item.errorType);
  if (wrongs.length === 0) return 100;
  const average = wrongs.reduce((sum, item) => sum + (SEVERITY[item.errorType] ?? 0.5), 0) / wrongs.length;
  return Math.round(100 * (1 - average * 0.55));
}

export function knowledgeRows(items) {
  const order = [];
  const groups = new Map();
  for (const item of items) {
    if (!groups.has(item.knowledge)) {
      groups.set(item.knowledge, { name: item.knowledge, earned: 0, total: 0, correct: 0, count: 0 });
      order.push(item.knowledge);
    }
    const group = groups.get(item.knowledge);
    group.earned += item.earned;
    group.total += item.points;
    group.count += 1;
    group.correct += item.correct ? 1 : 0;
  }
  return order.map((name) => groups.get(name));
}

export function summarize(attempts) {
  const items = attempts.flatMap((attempt) => attempt.items || []);
  const errorCounts = {};
  for (const item of items) {
    if (!item.correct && item.errorType) {
      errorCounts[item.errorType] = (errorCounts[item.errorType] || 0) + 1;
    }
  }
  const practiceRows = attempts.flatMap((attempt) => attempt.practice || []).filter((row) => row.checked);
  const practiceCorrect = practiceRows.filter((row) => row.correct).length;
  const practiceAcc = practiceRows.length ? Math.round((100 * practiceCorrect) / practiceRows.length) : 50;
  let trend = 0;
  if (attempts.length === 1 && attempts[0].total) {
    trend = Math.round((100 * attempts[0].score) / attempts[0].total);
  } else if (attempts.length >= 2) {
    const percent = (attempt) => (attempt.total ? (100 * attempt.score) / attempt.total : 0);
    const delta = percent(attempts[attempts.length - 1]) - percent(attempts[0]);
    trend = Math.max(0, Math.min(100, Math.round(50 + delta)));
  }
  const progress = attempts.length ? Math.round(0.5 * trend + 0.5 * practiceAcc) : 0;
  return {
    mastery: attempts.length ? masteryScore(items) : 0,
    errorScore: attempts.length ? errorTypeScore(items) : 0,
    progress,
    trend,
    practiceAcc,
    practiceDone: practiceRows.length,
    practiceCorrect,
    byKnowledge: knowledgeRows(items),
    errorCounts,
    papers: attempts.length,
  };
}

export const ERROR_TYPES = ["计算失误", "符号错误", "步骤遗漏", "审题偏差", "概念混淆"];
