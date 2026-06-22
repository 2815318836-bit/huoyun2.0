const bankPayload = window.QUESTION_BANK || { meta: { counts: {} }, questions: {} };
const bank = bankPayload.questions;

const typeMeta = {
  single: { label: "单选题", short: "单选", groupCount: 3, mode: "single" },
  judge: { label: "判断题", short: "判断", groupCount: 3, mode: "single" },
  multi: { label: "多选题", short: "多选", groupCount: 1, mode: "multi" },
};
const typeOrder = ["single", "judge", "multi"];
const wrongStorageKey = "freightQuizWrongBook.v1";

const state = {
  view: "select",
  type: "single",
  groupIndex: 0,
  session: [],
  sessionTitle: "",
  sessionMode: "practice",
  index: 0,
  selected: new Set(),
  records: [],
  stats: { correct: 0, wrong: 0 },
};

const els = {
  totalCount: document.querySelector("#totalCount"),
  wrongCount: document.querySelector("#wrongCount"),
  typeTabs: document.querySelector("#typeTabs"),
  groupList: document.querySelector("#groupList"),
  mainPanel: document.querySelector("#mainPanel"),
  showWrongBook: document.querySelector("#showWrongBook"),
  clearProgress: document.querySelector("#clearProgress"),
};

function getAllQuestions() {
  return typeOrder.flatMap((type) => bank[type] || []);
}

function getWrongBook() {
  try {
    return JSON.parse(localStorage.getItem(wrongStorageKey) || "{}");
  } catch {
    return {};
  }
}

function saveWrongBook(book) {
  localStorage.setItem(wrongStorageKey, JSON.stringify(book));
  updateCounts();
}

function questionKey(question) {
  return `${question.type}:${question.id}`;
}

function addWrong(question) {
  const book = getWrongBook();
  const key = questionKey(question);
  const item = book[key] || { type: question.type, id: question.id, count: 0, updatedAt: "" };
  item.count += 1;
  item.updatedAt = new Date().toISOString();
  book[key] = item;
  saveWrongBook(book);
}

function removeWrong(question) {
  const book = getWrongBook();
  delete book[questionKey(question)];
  saveWrongBook(book);
}

function findQuestion(type, id) {
  return (bank[type] || []).find((question) => question.id === id);
}

function getWrongQuestions() {
  const book = getWrongBook();
  return Object.values(book)
    .map((item) => ({ item, question: findQuestion(item.type, item.id) }))
    .filter((entry) => entry.question)
    .sort((a, b) => {
      const typeDiff = typeOrder.indexOf(a.question.type) - typeOrder.indexOf(b.question.type);
      return typeDiff || a.question.id - b.question.id;
    });
}

function splitGroups(questions, count) {
  if (count === 1) {
    return [questions];
  }
  const base = Math.floor(questions.length / count);
  const extra = questions.length % count;
  const groups = [];
  let start = 0;
  for (let index = 0; index < count; index += 1) {
    const size = base + (index < extra ? 1 : 0);
    groups.push(questions.slice(start, start + size));
    start += size;
  }
  return groups;
}

function groupsForType(type) {
  const questions = [...(bank[type] || [])].sort((a, b) => a.id - b.id);
  return splitGroups(questions, typeMeta[type].groupCount);
}

function normalizeAnswer(keys) {
  return [...keys].sort().join("");
}

function answerSet(answer) {
  return new Set([...answer]);
}

function formatAnswer(question, answer) {
  if (!answer) {
    return "未作答";
  }
  return [...answer]
    .map((key) => {
      const option = question.options.find((item) => item.key === key);
      return option ? `${key}. ${option.text}` : key;
    })
    .join("；");
}

function findRecord(question) {
  return state.records.find((record) => record.key === questionKey(question));
}

function answeredCount() {
  return state.records.length;
}

function unansweredCount() {
  return Math.max(state.session.length - answeredCount(), 0);
}

function upsertCurrentRecord() {
  const question = currentQuestion();
  if (!question) {
    return;
  }
  const key = questionKey(question);
  const selectedAnswer = normalizeAnswer(state.selected);
  state.records = state.records.filter((record) => record.key !== key);
  if (!selectedAnswer) {
    return;
  }
  state.records.push({
    key,
    type: question.type,
    id: question.id,
    selectedAnswer,
    correct: selectedAnswer === normalizeAnswer(question.answer),
  });
}

function loadAnswerForIndex(index) {
  const question = state.session[index];
  const record = question ? findRecord(question) : null;
  state.selected = answerSet(record?.selectedAnswer || "");
}

function canSubmitPaper() {
  return state.session.length > 0 && answeredCount() === state.session.length;
}

function optionStatus(question, option, selectedAnswer, revealAll = false) {
  const correctKeys = answerSet(question.answer);
  const selectedKeys = answerSet(selectedAnswer);
  const isCorrectKey = correctKeys.has(option.key);
  const isSelected = selectedKeys.has(option.key);

  if (isSelected && !isCorrectKey) {
    return "wrong";
  }
  if (isSelected && isCorrectKey) {
    return "correct";
  }
  if (isCorrectKey && revealAll) {
    return typeMeta[question.type].mode === "multi" && selectedAnswer ? "missed" : "correct";
  }
  return "";
}

function statusLabel(correct) {
  return correct ? "答对" : "答错";
}

function updateCounts() {
  const total = getAllQuestions().length;
  const wrong = getWrongQuestions().length;
  els.totalCount.textContent = `题库 ${total} 题`;
  els.wrongCount.textContent = `错题 ${wrong} 题`;
}

function renderTypeTabs() {
  els.typeTabs.innerHTML = typeOrder
    .map((type) => {
      const active = state.type === type ? " active" : "";
      return `<button class="type-button${active}" type="button" data-type="${type}">${typeMeta[type].short}</button>`;
    })
    .join("");
}

function renderGroupList() {
  const groups = groupsForType(state.type);
  els.groupList.innerHTML = groups
    .map((questions, index) => {
      const first = questions[0]?.id ?? 0;
      const last = questions[questions.length - 1]?.id ?? 0;
      const active = state.groupIndex === index && state.view !== "wrong" ? " active" : "";
      return `
        <button class="group-button${active}" type="button" data-group="${index}">
          <strong>第 ${index + 1} 组</strong>
          <span>${first}-${last} 题，共 ${questions.length} 题</span>
        </button>
      `;
    })
    .join("");
}

function renderSelection() {
  const groups = groupsForType(state.type);
  const currentGroup = groups[state.groupIndex] || [];
  const type = typeMeta[state.type];
  els.mainPanel.innerHTML = `
    <section class="selection-view">
      <div class="hero-line" aria-hidden="true"></div>
      <div>
        <h2 class="view-heading">${type.label} 第 ${state.groupIndex + 1} 组</h2>
        <p class="subtle">范围：${currentGroup[0]?.id ?? 0}-${currentGroup[currentGroup.length - 1]?.id ?? 0}，共 ${currentGroup.length} 题。</p>
      </div>
      <div class="summary-grid">
        <div class="summary-item"><strong>${bank.single.length}</strong><span>单选题</span></div>
        <div class="summary-item"><strong>${bank.judge.length}</strong><span>判断题</span></div>
        <div class="summary-item"><strong>${bank.multi.length}</strong><span>多选题</span></div>
      </div>
      <div class="action-row">
        <button class="primary-button" type="button" data-start-current>开始刷题</button>
        <button class="secondary-button" type="button" data-show-wrong>查看错题本</button>
      </div>
    </section>
  `;
}

function startSession(questions, title, mode = "practice") {
  state.view = "quiz";
  state.session = [...questions].sort((a, b) => a.id - b.id);
  state.sessionTitle = title;
  state.sessionMode = mode;
  state.index = 0;
  state.selected = new Set();
  state.records = [];
  state.stats = { correct: 0, wrong: 0 };
  render();
  els.mainPanel.focus();
}

function startCurrentGroup() {
  const groups = groupsForType(state.type);
  const questions = groups[state.groupIndex] || [];
  startSession(questions, `${typeMeta[state.type].label} 第 ${state.groupIndex + 1} 组`);
}

function currentQuestion() {
  return state.session[state.index];
}

function renderQuiz() {
  const question = currentQuestion();
  if (!question) {
    renderFinish();
    return;
  }
  const progress = Math.round(((state.index + 1) / state.session.length) * 100);
  const canGoPrev = state.index > 0;
  const canGoNext = state.index < state.session.length - 1 && state.selected.size > 0;
  const canSubmit = canSubmitPaper();
  const unanswered = unansweredCount();
  const selectedAnswer = normalizeAnswer(state.selected);

  els.mainPanel.innerHTML = `
    <section class="quiz-view">
      <div class="quiz-head">
        <div class="quiz-meta">
          <span class="pill">${state.sessionTitle}</span>
          <span class="pill">第 ${state.index + 1} / ${state.session.length} 题</span>
          <span class="pill">${typeMeta[question.type].label} ${question.id}</span>
          <span class="pill">已答 ${answeredCount()} / ${state.session.length}</span>
        </div>
        <div class="progress" aria-hidden="true"><span style="width: ${progress}%"></span></div>
      </div>

      <div class="question-card">
        <h2 class="question-title">${escapeHtml(question.question)}</h2>
        <div class="options">
          ${question.options.map((option) => renderOption(question, option, selectedAnswer, false)).join("")}
        </div>
        <div class="action-row">
          <button class="secondary-button" type="button" data-prev ${canGoPrev ? "" : "disabled"}>上一题</button>
          ${
            state.index < state.session.length - 1
              ? `<button class="primary-button" type="button" data-next ${canGoNext ? "" : "disabled"}>下一题</button>`
              : ""
          }
          <button class="${canSubmit ? "primary-button" : "secondary-button"}" type="button" data-submit-paper ${canSubmit ? "" : "disabled"}>${canSubmit ? "交卷" : `还有 ${unanswered} 题未答`}</button>
          <button class="secondary-button" type="button" data-back-select>换组</button>
        </div>
      </div>
    </section>
  `;
}

function renderOption(question, option, selectedAnswer, revealAll) {
  const selected = answerSet(selectedAnswer).has(option.key);
  const status = revealAll ? optionStatus(question, option, selectedAnswer, true) : "";
  const className = [selected && !status ? "selected" : "", status].filter(Boolean).join(" ");
  const disabled = revealAll ? "disabled" : "";
  return `
    <button class="option-button ${className}" type="button" data-option="${option.key}" ${disabled}>
      <span class="option-key">${option.key}</span>
      <span>${escapeHtml(option.text)}</span>
    </button>
  `;
}

function renderReviewOption(question, option, selectedAnswer) {
  const status = optionStatus(question, option, selectedAnswer, true);
  const selected = answerSet(selectedAnswer).has(option.key);
  const className = [selected && !status ? "selected" : "", status].filter(Boolean).join(" ");
  return `
    <div class="option-button review-option ${className}">
      <span class="option-key">${option.key}</span>
      <span>${escapeHtml(option.text)}</span>
    </div>
  `;
}

function goToQuestion(index) {
  if (index < 0 || index >= state.session.length) {
    return;
  }
  upsertCurrentRecord();
  state.index = index;
  loadAnswerForIndex(index);
  render();
  els.mainPanel.focus();
}

function submitPaper() {
  upsertCurrentRecord();
  if (!canSubmitPaper()) {
    renderQuiz();
    return;
  }
  finalizeSessionRecords();
  state.view = "finish";
  render();
  els.mainPanel.focus();
}

function finalizeSessionRecords() {
  const correct = state.records.filter((record) => record.correct).length;
  const wrong = state.records.length - correct;
  state.stats = { correct, wrong };
  state.records.forEach((record) => {
    const question = findQuestion(record.type, record.id);
    if (!question) {
      return;
    }
    if (record.correct) {
      removeWrong(question);
    } else {
      addWrong(question);
    }
  });
}

function renderFinish() {
  const total = state.session.length;
  const correct = state.stats.correct;
  const wrong = state.stats.wrong;
  const rate = total ? Math.round((correct / total) * 100) : 0;
  els.mainPanel.innerHTML = `
    <section class="finish-view">
      <div class="hero-line" aria-hidden="true"></div>
      <div>
        <h2 class="view-heading">本组完成</h2>
        <p class="subtle">${state.sessionTitle}，正确率 ${rate}%。</p>
      </div>
      <div class="summary-grid">
        <div class="summary-item"><strong>${total}</strong><span>本次题量</span></div>
        <div class="summary-item"><strong>${correct}</strong><span>答对</span></div>
        <div class="summary-item"><strong>${wrong}</strong><span>答错</span></div>
      </div>
      <div class="legend-row" aria-label="颜色说明">
        <span><i class="legend-dot ok"></i>正确选项</span>
        <span><i class="legend-dot miss"></i>少选选项</span>
        <span><i class="legend-dot bad"></i>选错选项</span>
      </div>
      <div class="action-row sticky-actions">
        <button class="primary-button" type="button" data-repeat>再刷一遍</button>
        <button class="secondary-button" type="button" data-back-select>重新选组</button>
        <button class="secondary-button" type="button" data-show-wrong>错题本</button>
      </div>
      <div class="review-list">
        ${state.session.map((question, index) => renderReviewItem(question, index)).join("")}
      </div>
    </section>
  `;
}

function renderReviewItem(question, index) {
  const record = findRecord(question) || {
    selectedAnswer: "",
    correct: false,
  };
  const statusClass = record.correct ? "ok" : "bad";
  return `
    <article class="review-item ${statusClass}">
      <div class="review-item-head">
        <div>
          <strong>${index + 1}. ${typeMeta[question.type].label} ${question.id}</strong>
          <span class="review-status ${statusClass}">${statusLabel(record.correct)}</span>
        </div>
        <div class="review-answer-line">
          <span>你的答案：${escapeHtml(formatAnswer(question, record.selectedAnswer))}</span>
          <span>正确答案：${escapeHtml(formatAnswer(question, question.answer))}</span>
        </div>
      </div>
      <p class="review-question">${escapeHtml(question.question)}</p>
      <div class="options review-options">
        ${question.options.map((option) => renderReviewOption(question, option, record.selectedAnswer)).join("")}
      </div>
    </article>
  `;
}

function renderWrongBook() {
  const entries = getWrongQuestions();
  const list = entries
    .map(({ item, question }) => {
      const type = typeMeta[question.type].label;
      return `
        <article class="wrong-item">
          <div class="wrong-item-header">
            <span>${type} ${question.id} · 错 ${item.count} 次</span>
            <button class="secondary-button small-button" type="button" data-remove-wrong="${questionKey(question)}">移除</button>
          </div>
          <p>${escapeHtml(question.question)}</p>
          <p class="subtle">答案：${escapeHtml(formatAnswer(question, question.answer))}</p>
        </article>
      `;
    })
    .join("");

  els.mainPanel.innerHTML = `
    <section class="wrong-view">
      <div class="hero-line" aria-hidden="true"></div>
      <div>
        <h2 class="view-heading">错题本</h2>
        <p class="subtle">当前共 ${entries.length} 道错题。</p>
      </div>
      ${
        entries.length
          ? `<div class="action-row">
              <button class="primary-button" type="button" data-start-wrong>重刷错题</button>
              <button class="secondary-button" type="button" data-clear-wrong>清空错题</button>
              <button class="secondary-button" type="button" data-back-select>返回选组</button>
            </div>
            <div class="wrong-list">${list}</div>`
          : `<div class="empty-state">
              <h3>暂无错题</h3>
              <div><button class="primary-button" type="button" data-back-select>返回选组</button></div>
            </div>`
      }
    </section>
  `;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function render() {
  updateCounts();
  renderTypeTabs();
  renderGroupList();
  if (state.view === "quiz") {
    renderQuiz();
  } else if (state.view === "finish") {
    renderFinish();
  } else if (state.view === "wrong") {
    renderWrongBook();
  } else {
    renderSelection();
  }
}

function goSelect() {
  state.view = "select";
  state.session = [];
  state.selected = new Set();
  state.records = [];
  render();
}

function clearWrongBook() {
  if (!getWrongQuestions().length) {
    return;
  }
  if (confirm("确定清空错题本吗？")) {
    saveWrongBook({});
    render();
  }
}

els.typeTabs.addEventListener("click", (event) => {
  const button = event.target.closest("[data-type]");
  if (!button) return;
  state.type = button.dataset.type;
  state.groupIndex = 0;
  state.view = "select";
  render();
});

els.groupList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-group]");
  if (!button) return;
  state.groupIndex = Number(button.dataset.group);
  state.view = "select";
  render();
});

els.mainPanel.addEventListener("click", (event) => {
  const optionButton = event.target.closest("[data-option]");
  if (optionButton && state.view === "quiz") {
    const question = currentQuestion();
    const key = optionButton.dataset.option;
    if (typeMeta[question.type].mode === "multi") {
      if (state.selected.has(key)) {
        state.selected.delete(key);
      } else {
        state.selected.add(key);
      }
    } else {
      state.selected = new Set([key]);
    }
    upsertCurrentRecord();
    renderQuiz();
    return;
  }

  if (event.target.closest("[data-start-current]")) {
    startCurrentGroup();
  } else if (event.target.closest("[data-prev]")) {
    goToQuestion(state.index - 1);
  } else if (event.target.closest("[data-next]")) {
    goToQuestion(state.index + 1);
  } else if (event.target.closest("[data-submit-paper]")) {
    submitPaper();
  } else if (event.target.closest("[data-repeat]")) {
    startSession(state.session, state.sessionTitle, state.sessionMode);
  } else if (event.target.closest("[data-back-select]")) {
    goSelect();
  } else if (event.target.closest("[data-show-wrong]")) {
    state.view = "wrong";
    render();
  } else if (event.target.closest("[data-start-wrong]")) {
    const questions = getWrongQuestions().map((entry) => entry.question);
    if (questions.length) {
      startSession(questions, "错题本", "wrong");
    }
  } else if (event.target.closest("[data-clear-wrong]")) {
    clearWrongBook();
  }

  const removeButton = event.target.closest("[data-remove-wrong]");
  if (removeButton) {
    const book = getWrongBook();
    delete book[removeButton.dataset.removeWrong];
    saveWrongBook(book);
    render();
  }
});

els.showWrongBook.addEventListener("click", () => {
  state.view = "wrong";
  render();
});

els.clearProgress.addEventListener("click", clearWrongBook);

document.addEventListener("keydown", (event) => {
  if (state.view !== "quiz") {
    return;
  }
  const question = currentQuestion();
  const option = question.options.find((item) => item.key.toLowerCase() === event.key.toLowerCase());
  if (!option) {
    return;
  }
  if (typeMeta[question.type].mode === "multi") {
    if (state.selected.has(option.key)) {
      state.selected.delete(option.key);
    } else {
      state.selected.add(option.key);
    }
  } else {
    state.selected = new Set([option.key]);
  }
  upsertCurrentRecord();
  renderQuiz();
});

render();
