import assert from "node:assert/strict";
import test from "node:test";
import { buildPractice, gradePaper, matchPaperId, normalizeAnswer, summarize, tipsFor } from "../js/engine.js";
import { KNOWLEDGE, PAPERS, PRACTICE } from "../js/papers.js";

function defaults(paper) {
  return Object.fromEntries(paper.questions.map((question) => [question.id, question.studentAnswer]));
}

function graded(id) {
  const paper = PAPERS.find((item) => item.id === id);
  return gradePaper(paper, defaults(paper));
}

test("normalizes fullwidth digits, equals signs, and units", () => {
  assert.equal(normalizeAnswer("Ｘ＝５"), "x=5");
  assert.equal(normalizeAnswer("３０升"), "30");
  assert.equal(normalizeAnswer("2.5"), "2.5");
  assert.equal(normalizeAnswer("70°"), "70");
});

test("grades the three sample papers from the handwriting on the page", () => {
  const linear = graded("linear");
  assert.equal(linear.score, 40);
  assert.equal(linear.total, 100);
  assert.deepEqual(
    linear.items.filter((item) => !item.correct).map((item) => item.id),
    ["q3", "q4", "q5"],
  );

  const fraction = graded("fraction");
  assert.equal(fraction.score, 60);
  assert.deepEqual(
    fraction.items.filter((item) => !item.correct).map((item) => item.id),
    ["q1", "q4"],
  );

  const geometry = graded("geometry");
  assert.equal(geometry.score, 50);
  assert.equal(geometry.total, 100);
  assert.deepEqual(
    geometry.items.filter((item) => !item.correct).map((item) => item.id),
    ["q4", "q5", "q6"],
  );
});

test("a corrected answer changes the score and drops that mistake", () => {
  const paper = PAPERS[0];
  const answers = defaults(paper);
  answers.q3 = "x = 5";
  const result = gradePaper(paper, answers);
  assert.equal(result.score, 60);
  assert.equal(result.items[2].correct, true);
  assert.equal(result.items[2].errorType, null);
});

test("a different wrong answer does not reuse the sample mistake", () => {
  const paper = PAPERS[0];
  const answers = defaults(paper);
  answers.q3 = "x = 9";
  const result = gradePaper(paper, answers);
  assert.equal(result.items[2].correct, false);
  assert.equal(result.items[2].errorType, "计算失误");
  assert.match(result.items[2].explanation, /标准答案是 x = 5/);
});

test("tips name the weak skill, a technique, and a pitfall", () => {
  const tips = tipsFor(graded("linear").items);
  assert.deepEqual(
    tips.map((tip) => tip.name),
    ["移项", "含分数系数的方程", "列方程解应用题"],
  );
  for (const tip of tips) {
    assert.ok(tip.technique.length > 8);
    assert.ok(tip.pitfall.length > 4);
  }
});

test("practice uses the weak points and hides nothing in the prompt itself", () => {
  const linear = graded("linear");
  const practice = buildPractice(linear.items);
  assert.ok(practice.length >= 2 && practice.length <= 3);
  const weak = new Set(["移项", "含分数系数的方程", "列方程解应用题"]);
  assert.ok(practice.every((problem) => weak.has(problem.knowledge)));
  const examPrompts = new Set(PAPERS.flatMap((paper) => paper.questions.map((question) => question.prompt)));
  assert.ok(practice.every((problem) => !examPrompts.has(problem.prompt)));

  const fraction = buildPractice(graded("fraction").items);
  assert.equal(fraction.length, 3);
  assert.ok(fraction.every((problem) => problem.knowledge === "异分母分数加法" || problem.knowledge === "分数除法"));
});

test("all-correct papers still produce a short practice set", () => {
  const paper = PAPERS[0];
  const answers = Object.fromEntries(paper.questions.map((question) => [question.id, question.displayAnswer.replace(" 元", "").replace(" 升", "")]));
  answers.q1 = "x = 6";
  answers.q2 = "x = 7";
  answers.q3 = "x = 5";
  answers.q4 = "x = 8";
  answers.q5 = "11";
  const result = gradePaper(paper, answers);
  assert.equal(result.score, 100);
  const practice = buildPractice(result.items);
  assert.ok(practice.length >= 2 && practice.length <= 3);
});

test("profile combines earlier papers and practice", () => {
  const linear = graded("linear");
  const fraction = graded("fraction");
  const first = {
    score: linear.score,
    total: linear.total,
    items: linear.items,
    practice: [],
  };
  const summary = summarize([first]);
  assert.equal(summary.mastery, 40);
  assert.equal(summary.errorScore, 57);
  assert.equal(summary.progress, 45);

  const withPractice = summarize([
    {
      ...first,
      practice: [
        { checked: true, correct: true },
        { checked: true, correct: true },
        { checked: true, correct: true },
      ],
    },
  ]);
  assert.equal(withPractice.progress, 70);

  const both = summarize([
    first,
    { score: fraction.score, total: fraction.total, items: fraction.items, practice: [] },
  ]);
  assert.equal(both.mastery, 50);
  assert.equal(both.papers, 2);
  assert.equal(both.trend, 70);
  assert.equal(both.progress, 60);
  assert.equal(both.errorCounts.概念混淆, 2);
});

test("papers are complete and every skill has a tip", () => {
  for (const paper of PAPERS) {
    assert.equal(
      paper.questions.reduce((sum, question) => sum + question.points, 0),
      100,
    );
    for (const question of paper.questions) assert.ok(KNOWLEDGE[question.knowledge]);
  }
  for (const problem of PRACTICE) assert.ok(KNOWLEDGE[problem.knowledge]);
});

test("upload filenames can select a built-in paper", () => {
  assert.equal(matchPaperId("linear.svg", PAPERS), "linear");
  assert.equal(matchPaperId("周末分数.png", PAPERS), "fraction");
  assert.equal(matchPaperId("photo.jpg", PAPERS), null);
});
