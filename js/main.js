import { PAPERS, paperById } from "./papers.js";
import {
  ERROR_TYPES,
  buildPractice,
  gradePaper,
  isAccepted,
  matchPaperId,
  normalizeAnswer,
  summarize,
  tipsFor,
} from "./engine.js";
import { cleanNickname, clearStore, loadStore, markPractice, saveStore, upsertAttempt } from "./store.js";

const main = document.querySelector("#main");
const live = document.querySelector("#live");
const nicknameInput = document.querySelector("#nickname");
const cameraInput = document.querySelector("#camera-input");
const albumInput = document.querySelector("#album-input");

const state = {
  tab: "review",
  paper: null,
  imageSrc: "",
  imageAlt: "",
  uploadUnmatched: false,
  answers: {},
  result: null,
  attemptId: null,
  practiceProblems: [],
  practiceInputs: {},
  checked: {},
  dirty: false,
  message: "",
  confirmClear: false,
  storageWarning: "",
};

let objectUrl = null;

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else node.setAttribute(key, String(value));
  }
  for (const child of children) {
    if (child == null) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

function svgEl(name, attrs = {}, text) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  if (text != null) node.textContent = text;
  return node;
}

function uid() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `a-${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`;
}

function rememberUpload(file) {
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = URL.createObjectURL(file);
  return objectUrl;
}

function releaseUpload() {
  if (!objectUrl) return;
  URL.revokeObjectURL(objectUrl);
  objectUrl = null;
}

function openPaper(paper, imageSrc, options) {
  state.paper = paper;
  state.imageSrc = imageSrc;
  state.imageAlt = options.alt || paper.alt;
  state.uploadUnmatched = options.unmatched;
  state.answers = Object.fromEntries(paper.questions.map((question) => [question.id, question.studentAnswer]));
  state.result = null;
  state.attemptId = null;
  state.practiceProblems = [];
  state.practiceInputs = {};
  state.checked = {};
  state.dirty = false;
  state.message = "";
  state.tab = "review";
  syncTabs();
  render();
}

function openSample(paper) {
  releaseUpload();
  openPaper(paper, paper.image, { unmatched: false, alt: paper.alt });
}

function onFile(file) {
  if (!file) return;
  if (!file.type.startsWith("image/") || file.size > 8 * 1024 * 1024) {
    state.message = file.type.startsWith("image/") ? "图片请小于 8 MB。" : "请选择图片文件。";
    state.tab = "review";
    syncTabs();
    render();
    return;
  }
  const matchedId = matchPaperId(file.name, PAPERS);
  const paper = matchedId ? paperById(matchedId) : PAPERS[0];
  const src = rememberUpload(file);
  openPaper(paper, src, {
    unmatched: !matchedId,
    alt: matchedId ? paper.alt : "你选择的试卷照片",
  });
}

function grade() {
  const result = gradePaper(state.paper, state.answers);
  const practiceProblems = buildPractice(result.items);
  const attempt = {
    id: state.attemptId || uid(),
    paperId: state.paper.id,
    title: state.paper.title,
    gradeLabel: state.paper.grade,
    at: new Date().toISOString(),
    score: result.score,
    total: result.total,
    items: result.items.map((item) => ({
      knowledge: item.knowledge,
      correct: item.correct,
      errorType: item.errorType,
      points: item.points,
      earned: item.earned,
    })),
    practice: practiceProblems.map((problem) => ({
      id: problem.id,
      knowledge: problem.knowledge,
      checked: false,
      correct: false,
    })),
  };
  try {
    upsertAttempt(attempt);
    state.storageWarning = "";
  } catch {
    state.storageWarning = "这台浏览器没有留下记录，这次批改仍然可以看。";
  }
  state.attemptId = attempt.id;
  state.result = result;
  state.practiceProblems = practiceProblems;
  state.practiceInputs = {};
  state.checked = {};
  state.dirty = false;
  const right = result.items.filter((item) => item.correct).length;
  live.textContent = `批改完成，得分 ${result.score}，满分 ${result.total}，做对 ${right} 题。`;
  render();
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.getElementById("result-top")?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
}

function syncTabs() {
  for (const button of document.querySelectorAll("[data-tab]")) {
    const on = button.dataset.tab === state.tab;
    button.setAttribute("aria-selected", on ? "true" : "false");
  }
}

function currentSummary() {
  try {
    return summarize(loadStore().attempts);
  } catch {
    return null;
  }
}

function render() {
  main.replaceChildren();
  if (state.tab === "profile") main.append(renderProfile());
  else main.append(state.paper ? renderReview() : renderHome());
}

function renderHome() {
  const data = safeStore();
  const box = el("section", {}, [
    el("p", { class: "chip", text: "演示模式 · 不需要密钥" }),
    el("h2", { text: "看一张数学卷" }),
    el("p", {
      class: "lede",
      text: "拍照、从相册选图，或打开下面的样卷。批改只在这台设备上完成，不会发给模型。",
    }),
  ]);
  if (state.message) box.append(el("p", { class: "warn", text: state.message }));
  if (state.storageWarning) box.append(el("p", { class: "warn", text: state.storageWarning }));
  box.append(
    el("ol", { class: "steps" }, [
      el("li", {}, [el("strong", { text: "1" }), "看卷面"]),
      el("li", {}, [el("strong", { text: "2" }), "对错和错因"]),
      el("li", {}, [el("strong", { text: "3" }), "练薄弱点"]),
    ]),
    el("div", { class: "actions" }, [
      actionButton("拍照", "用摄像头", () => cameraInput.click()),
      actionButton("相册", "选择图片", () => albumInput.click(), true),
    ]),
    el("h3", { class: "section-title", text: "内置样卷" }),
  );
  const samples = el("div", { class: "samples" });
  for (const paper of PAPERS) {
    const button = el("button", { type: "button", class: "sample" });
    const image = el("img", { src: paper.image, alt: "" });
    button.append(
      image,
      el("span", {}, [
        el("span", { class: "quiet", text: paper.grade }),
        el("b", { text: paper.title }),
        el("span", { text: `${paper.questions.length} 题 · ${paper.blurb}` }),
      ]),
    );
    button.addEventListener("click", () => openSample(paper));
    samples.append(button);
  }
  box.append(samples);
  if (data.attempts.length) {
    box.append(
      el("p", {
        class: "quiet",
        text: `${data.nickname} 已有 ${data.attempts.length} 份批改。打开「学生三维」可以看到累积画像。`,
      }),
    );
  }
  return box;
}

function actionButton(title, detail, onClick, secondary) {
  const button = el("button", { type: "button", class: secondary ? "btn secondary" : "btn" }, [
    el("span", {}, [title, el("small", { text: detail })]),
  ]);
  button.addEventListener("click", onClick);
  return button;
}

function renderReview() {
  const back = el("button", { type: "button", class: "btn ghost back", text: "返回选卷" });
  back.addEventListener("click", () => {
    releaseUpload();
    state.paper = null;
    state.result = null;
    state.attemptId = null;
    state.practiceProblems = [];
    state.message = "";
    state.imageSrc = "";
    render();
  });
  return el("div", {}, [back, el("div", { class: "review-layout" }, [renderSheet(), renderWork()])]);
}

function renderSheet() {
  const sheet = el("section", { class: "sheet" });
  sheet.append(
    el("div", { class: "actions" }, [
      actionButton("重拍", "摄像头", () => cameraInput.click(), true),
      actionButton("换图片", "相册", () => albumInput.click(), true),
    ]),
  );
  const image = el("img", { class: "paper", src: state.imageSrc, alt: state.imageAlt });
  sheet.append(image);
  if (state.uploadUnmatched) {
    sheet.append(
      el("p", {
        class: "warn",
        text: "这张照片不是内置样卷，本地读不了手写内容。下面用一份样卷的题目和作答，方便你走完批改、提示、练习和画像。照片只留在这台设备上。",
      }),
    );
    const choices = el("div", { class: "choices" });
    for (const paper of PAPERS) {
      const label = el("label", { class: "choice" });
      const input = el("input", { type: "radio", name: "template" });
      if (paper.id === state.paper.id) input.checked = true;
      input.addEventListener("change", () => {
        if (!input.checked) return;
        openPaper(paper, state.imageSrc, { unmatched: true, alt: state.imageAlt });
      });
      label.append(input, el("span", { text: `${paper.grade} ${paper.title}` }));
      choices.append(label);
    }
    sheet.append(el("p", { class: "quiet", text: "用哪份样卷来批改" }), choices);
  } else if (objectUrl) {
    sheet.append(el("p", { class: "note", text: "这张图片对上了内置样卷，作答已按样卷填好。" }));
  } else {
    sheet.append(el("p", { class: "note", text: "样卷作答已填好。可以直接批改，也可以改成别的答案。" }));
  }
  return sheet;
}

function renderWork() {
  const work = el("section");
  work.append(el("h2", { text: `${state.paper.grade} · ${state.paper.title}` }));
  if (state.message) work.append(el("p", { class: "warn", text: state.message }));
  const list = el("div", { class: "stack" });
  state.paper.questions.forEach((question, index) => {
    list.append(renderQuestion(question, index));
  });
  work.append(list);
  const gradeButton = el("button", {
    type: "button",
    class: "btn",
    text: state.result ? "重新批改" : "开始批改",
  });
  gradeButton.addEventListener("click", grade);
  work.append(el("div", { class: "grade-bar" }, [gradeButton]));
  const dirty = el("p", { id: "dirty-note", class: "quiet", text: "作答已改，重新批改后画像会更新。" });
  dirty.hidden = !state.dirty;
  work.append(dirty);
  if (state.result) work.append(renderResult());
  return work;
}

function renderQuestion(question, index) {
  const item = state.result?.items.find((row) => row.id === question.id);
  const card = el("article", { class: "q" });
  const title = el("header");
  title.append(el("h3", {}, [el("span", { class: "q-no", "aria-hidden": "true", text: String(index + 1) }), ` ${question.prompt}`]));
  if (item) {
    title.append(
      el("span", {
        class: item.correct ? "mark ok" : "mark bad",
        text: item.correct ? `得分 ${item.earned}` : "得分 0",
      }),
    );
  } else {
    title.append(el("span", { class: "quiet", text: `${question.points} 分` }));
  }
  card.append(title);
  const label = el("label", { class: "answer", text: "作答" });
  const input = el("input", {
    type: "text",
    value: state.answers[question.id] ?? "",
    autocomplete: "off",
    spellcheck: "false",
    "aria-label": `第 ${index + 1} 题作答`,
  });
  input.addEventListener("input", () => {
    state.answers[question.id] = input.value;
    if (!state.result) return;
    state.dirty = true;
    const note = document.getElementById("dirty-note");
    if (note) note.hidden = false;
  });
  label.append(input);
  card.append(label);
  if (item) {
    const bits = [item.explanation];
    if (!item.correct) bits.push(`标准答案：${item.displayAnswer}`);
    if (item.errorType) bits.push(`错因：${item.errorType}`);
    card.append(el("p", { class: "explain", text: bits.join(" ") }));
    card.append(el("p", { class: "quiet", text: `知识点：${item.knowledge} · 本题 ${item.points} 分` }));
  }
  return card;
}

function renderResult() {
  const result = state.result;
  const right = result.items.filter((item) => item.correct).length;
  const percent = result.total ? Math.round((100 * result.score) / result.total) : 0;
  const box = el("div", { id: "result-top", class: "stack" });
  box.style.marginTop = "18px";
  const summary = currentSummary();
  const score = el("div", { class: "score-card" });
  const ring = el("div", { class: "ring" }, [el("span", { text: String(result.score) })]);
  ring.style.setProperty("--p", String(percent));
  const copy = el("div", {}, [
    el("p", { class: "kicker", text: percent >= 85 ? "很稳" : percent >= 60 ? "不错" : "待提高" }),
    el("h3", { text: `${result.score} / ${result.total}` }),
    el("p", { text: `做对 ${right} 题，共 ${result.items.length} 题。` }),
  ]);
  if (summary && state.attemptId) {
    copy.append(
      el("p", {
        class: "quiet",
        id: "summary-line",
        text: `已记入本机画像 · 知识点掌握 ${summary.mastery} · 错因类型 ${summary.errorScore} · 练习进步 ${summary.progress}`,
      }),
    );
  }
  if (state.storageWarning) copy.append(el("p", { class: "warn", text: state.storageWarning }));
  score.append(ring, copy);
  box.append(score);

  const tips = tipsFor(result.items);
  box.append(el("h3", { class: "section-title", text: "知识点提示" }));
  if (!tips.length) {
    box.append(el("p", { class: "note", text: "这张卷子没有错题。下面用同范围的题目巩固一下。" }));
  }
  for (const tip of tips) {
    box.append(
      el("article", { class: "tip" }, [
        el("p", { class: "kicker", text: "知识点" }),
        el("b", { text: tip.name }),
        el("p", { class: "pair" }, [el("b", { text: "手法" }), tip.technique]),
        el("p", { class: "pair" }, [el("b", { text: "易错" }), tip.pitfall]),
      ]),
    );
  }

  box.append(el("h3", { class: "section-title", text: "针对性练习" }));
  box.append(el("p", { class: "quiet", text: "答案先藏着。写完再核对，对错会记进练习进步。" }));
  state.practiceProblems.forEach((problem, index) => box.append(renderPractice(problem, index)));

  const toProfile = el("button", { type: "button", class: "btn secondary", text: "查看学生三维" });
  toProfile.addEventListener("click", () => {
    state.tab = "profile";
    syncTabs();
    render();
    window.scrollTo(0, 0);
  });
  box.append(toProfile);
  return box;
}

function renderPractice(problem, index) {
  const card = el("article", { class: "practice" });
  card.append(
    el("header", {}, [
      el("h3", { text: `${index + 1}. ${problem.prompt}` }),
      el("span", { class: "quiet", text: problem.knowledge }),
    ]),
  );
  const known = state.checked[problem.id];
  if (known) {
    card.append(practiceOutcome(problem, known.correct));
    return card;
  }
  const label = el("label", { text: "你的答案" });
  const input = el("input", {
    type: "text",
    value: state.practiceInputs[problem.id] ?? "",
    autocomplete: "off",
    spellcheck: "false",
    "aria-label": `练习 ${index + 1} 的答案`,
  });
  const hint = el("p", { class: "warn", text: "请先写下你的答案。" });
  hint.hidden = true;
  input.addEventListener("input", () => {
    state.practiceInputs[problem.id] = input.value;
    hint.hidden = true;
  });
  const button = el("button", { type: "button", class: "btn", text: "核对" });
  button.style.marginTop = "8px";
  const check = () => {
    const value = input.value;
    state.practiceInputs[problem.id] = value;
    if (!normalizeAnswer(value)) {
      hint.hidden = false;
      return;
    }
    const correct = isAccepted(problem.accept, value);
    state.checked[problem.id] = { correct };
    if (state.attemptId) {
      try {
        markPractice(state.attemptId, problem.id, correct);
      } catch {
        state.storageWarning = "练习结果没能写进本机记录。";
      }
    }
    card.querySelector("label")?.remove();
    hint.remove();
    button.remove();
    card.append(practiceOutcome(problem, correct));
    const line = document.getElementById("summary-line");
    const summary = currentSummary();
    if (line && summary) {
      line.textContent = `已记入本机画像 · 知识点掌握 ${summary.mastery} · 错因类型 ${summary.errorScore} · 练习进步 ${summary.progress}`;
    }
    live.textContent = correct ? "练习做对了。答案已经显示。" : "练习还不一样。答案已经显示。";
  };
  button.addEventListener("click", check);
  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    check();
  });
  label.append(input);
  card.append(label, hint, button);
  return card;
}

function practiceOutcome(problem, correct) {
  return el("div", {}, [
    el("p", { class: correct ? "mark ok" : "mark bad", text: correct ? "做对了" : "还不一样" }),
    el("p", {}, [el("b", { text: "答案 " }), problem.displayAnswer]),
    el("p", { class: "explain", text: problem.solution }),
  ]);
}

function renderProfile() {
  const data = safeStore();
  const box = el("section");
  box.append(el("h2", { text: `${data.nickname}的学生三维` }));
  if (state.storageWarning) box.append(el("p", { class: "warn", text: state.storageWarning }));
  if (!data.attempts.length) {
    box.append(
      el("p", { class: "note", text: "先批改一份试卷。知识点掌握、错因类型和练习进步会从这份卷子开始累积，刷新页面也还在。" }),
    );
    return box;
  }
  const summary = summarize(data.attempts);
  box.append(el("p", { class: "lede", text: `已记 ${summary.papers} 份试卷。三项都会把以前的卷子算进去。` }));
  box.append(renderRadar(summary));
  box.append(
    el("details", { class: "formula" }, [
      el("summary", { text: "这三项怎么算" }),
      el("p", { text: "知识点掌握：每个出现过的知识点，按得分率取平均。小题分值不同时，也按分数而不是按题数。" }),
      el("p", { text: "错因类型：没有错题是 100，表示错因轻。概念混淆和审题偏差比计算失误更拉低这项。下面的条形是各类错因各出现了几次。" }),
      el("p", { text: "练习进步：试卷走势和针对性练习的正确率各占一半。只有一份卷子时，走势就是该卷得分率；还没核对练习时，练习那一半先按 50 计。" }),
    ]),
  );

  box.append(el("h3", { class: "section-title", text: "知识点掌握" }));
  const knowledge = el("div", { class: "bars panel" });
  for (const row of summary.byKnowledge) {
    const percent = row.total ? Math.round((100 * row.earned) / row.total) : 0;
    knowledge.append(barRow(row.name, percent, `${row.earned}/${row.total}`, false));
  }
  box.append(knowledge);

  box.append(el("h3", { class: "section-title", text: "错因类型" }));
  const errors = el("div", { class: "bars panel" });
  const maxError = Math.max(1, ...ERROR_TYPES.map((type) => summary.errorCounts[type] || 0));
  for (const type of ERROR_TYPES) {
    const count = summary.errorCounts[type] || 0;
    errors.append(barRow(type, Math.round((100 * count) / maxError), `${count} 次`, true));
  }
  box.append(errors);

  box.append(el("h3", { class: "section-title", text: "练习进步" }));
  const progress = el("div", { class: "panel" });
  progress.append(
    el("p", {
      text: summary.practiceDone
        ? `现在是 ${summary.progress}。试卷走势 ${summary.trend}，练习正确率 ${summary.practiceAcc}。`
        : `现在是 ${summary.progress}。试卷走势 ${summary.trend}。练习还没核对。`,
    }),
  );
  progress.append(
    el("p", {
      class: "quiet",
      text: summary.practiceDone
        ? `针对性练习核对了 ${summary.practiceDone} 题，做对 ${summary.practiceCorrect} 题。`
        : "核对针对性练习之后，这一项会跟着变。",
    }),
  );
  const spark = renderSpark(data.attempts);
  if (spark) progress.append(spark);
  box.append(progress);

  box.append(el("h3", { class: "section-title", text: "以前的试卷" }));
  const history = el("ul", { class: "history" });
  for (const attempt of [...data.attempts].reverse()) {
    const when = new Intl.DateTimeFormat("zh-CN", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(attempt.at));
    const button = el("button", { type: "button" }, [
      el("span", { class: "history-meta" }, [
        el("b", { text: `${attempt.gradeLabel} · ${attempt.title}` }),
        el("span", { class: "quiet", text: when }),
      ]),
      el("b", { text: `${attempt.score}/${attempt.total}` }),
    ]);
    button.style.display = "flex";
    button.style.justifyContent = "space-between";
    button.style.gap = "12px";
    button.addEventListener("click", () => {
      const paper = paperById(attempt.paperId);
      if (paper) openSample(paper);
    });
    history.append(el("li", {}, [button]));
  }
  box.append(history);

  const clear = el("button", {
    type: "button",
    class: "btn ghost",
    text: state.confirmClear ? "再点一次，清除本机记录" : "清除本机记录",
  });
  clear.addEventListener("click", () => {
    if (!state.confirmClear) {
      state.confirmClear = true;
      render();
      return;
    }
    try {
      clearStore();
    } catch {
      state.storageWarning = "没能清除本机记录。";
    }
    nicknameInput.value = "同学";
    state.confirmClear = false;
    state.attemptId = null;
    render();
  });
  box.append(clear);
  return box;
}

function barRow(label, percent, end, bad) {
  const row = el("div", { class: "bar-row" }, [el("span", { text: label })]);
  const track = el("div", { class: "track" });
  const fill = el("span", { class: bad ? "fill bad" : "fill" });
  fill.style.width = `${Math.max(0, Math.min(100, percent))}%`;
  track.append(fill);
  row.append(track, el("em", { text: end }));
  return row;
}

function renderRadar(summary) {
  const values = [
    { label: "知识点掌握", value: summary.mastery },
    { label: "错因类型", value: summary.errorScore },
    { label: "练习进步", value: summary.progress },
  ];
  const svg = svgEl("svg", { viewBox: "0 0 360 320", role: "img" });
  svg.setAttribute(
    "aria-label",
    values.map((item) => `${item.label} ${item.value}`).join("，"),
  );
  const cx = 180;
  const cy = 158;
  const radius = 74;
  const point = (index, scale) => {
    const angle = -Math.PI / 2 + (index * 2 * Math.PI) / values.length;
    return [cx + radius * scale * Math.cos(angle), cy + radius * scale * Math.sin(angle)];
  };
  for (const ring of [0.25, 0.5, 0.75, 1]) {
    svg.append(svgEl("polygon", {
      points: values.map((_, index) => point(index, ring).join(",")).join(" "),
      fill: "none",
      stroke: "#ddd6cb",
      "stroke-width": "1",
    }));
  }
  values.forEach((_, index) => {
    const [x, y] = point(index, 1);
    svg.append(svgEl("line", { x1: cx, y1: cy, x2: x, y2: y, stroke: "#ddd6cb" }));
  });
  svg.append(svgEl("polygon", {
    points: values.map((item, index) => point(index, item.value / 100).join(",")).join(" "),
    fill: "rgba(159, 45, 34, 0.14)",
    stroke: "#9f2d22",
    "stroke-width": "2",
  }));
  values.forEach((item, index) => {
    const [x, y] = point(index, Math.max(item.value, 8) / 100);
    svg.append(svgEl("circle", { cx: x, cy: y, r: 3.5, fill: "#9f2d22" }));
    const [lx, ly] = point(index, 1.42);
    const anchor = index === 0 ? "middle" : index === 1 ? "start" : "end";
    const text = svgEl("text", {
      x: lx,
      y: ly,
      "text-anchor": anchor,
      fill: "#1a1814",
      "font-size": "13",
      "font-family": "WenQuanYi Micro Hei, Droid Sans Fallback, sans-serif",
    }, `${item.label} ${item.value}`);
    svg.append(text);
  });
  return el("div", { class: "radar-wrap panel" }, [svg]);
}

function renderSpark(attempts) {
  if (attempts.length < 2) return null;
  const svg = svgEl("svg", { viewBox: "0 0 300 88", role: "img" });
  const scores = attempts.map((attempt) => (attempt.total ? attempt.score / attempt.total : 0));
  svg.setAttribute("aria-label", `历次得分率 ${scores.map((score) => Math.round(score * 100)).join("、")}`);
  const coords = scores.map((score, index) => {
    const x = 16 + (index * 268) / (scores.length - 1);
    const y = 12 + (1 - score) * 60;
    return [x, y];
  });
  svg.append(svgEl("polyline", {
    points: coords.map((pair) => pair.join(",")).join(" "),
    fill: "none",
    stroke: "#1a1814",
    "stroke-width": "2",
  }));
  for (const [x, y] of coords) svg.append(svgEl("circle", { cx: x, cy: y, r: 3, fill: "#1a1814" }));
  return svg;
}

function safeStore() {
  try {
    return loadStore();
  } catch {
    state.storageWarning = "读不到本机记录。";
    return { nickname: cleanNickname(nicknameInput.value), attempts: [] };
  }
}

function bind() {
  const stored = safeStore();
  nicknameInput.value = stored.nickname;
  nicknameInput.addEventListener("focus", () => nicknameInput.select());
  nicknameInput.addEventListener("change", () => {
    const name = cleanNickname(nicknameInput.value);
    nicknameInput.value = name;
    try {
      const data = loadStore();
      data.nickname = name;
      saveStore(data);
      state.storageWarning = "";
    } catch {
      state.storageWarning = "昵称没能写进本机记录。";
    }
    if (state.tab === "profile" || !state.paper) render();
  });
  for (const button of document.querySelectorAll("[data-tab]")) {
    button.addEventListener("click", () => {
      state.tab = button.dataset.tab;
      state.confirmClear = false;
      syncTabs();
      render();
    });
  }
  for (const input of [cameraInput, albumInput]) {
    input.addEventListener("change", () => {
      const file = input.files && input.files[0];
      input.value = "";
      if (file) onFile(file);
    });
  }
  render();
}

bind();
