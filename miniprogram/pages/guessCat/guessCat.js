import { generateQuiz, QUIZ_TOTAL, getBestRecord, saveBestRecord } from "../../utils/guessCat";
import { text as textCfg } from "../../config";

Page({
  data: {
    // 页面状态：loading / playing / result / error
    phase: "loading",
    // 文案
    cfg: textCfg.guess_cat,
    // 当前题目索引（0-based）
    currentIndex: 0,
    // 总题数
    total: QUIZ_TOTAL,
    // 当前得分
    score: 0,
    // 当前题目
    question: null,
    // 用户选择的名字（用于高亮）
    selectedName: "",
    // 是否已选择（锁定按钮）
    answered: false,
    // 是否答对
    isCorrect: false,
    // 历史最佳
    bestRecord: 0,
    // 是否刷新最佳
    isNewBest: false,
    // 成绩评级
    resultRank: {},
    // 错误提示
    errorMsg: "",
  },

  onLoad() {
    this.setData({ bestRecord: getBestRecord() });
    this.startQuiz();
  },

  async startQuiz() {
    this.setData({ phase: "loading", currentIndex: 0, score: 0, total: QUIZ_TOTAL, selectedName: "", answered: false });
    try {
      const questions = await generateQuiz();
      if (!questions || questions.length === 0) {
        this.setData({ phase: "error", errorMsg: this.data.cfg.error_not_enough });
        return;
      }
      this.questions = questions;
      // 合并 setData：phase + total + 首题一起设置，避免中间帧闪烁
      const firstQ = questions[0];
      this.setData({
        phase: "playing",
        total: questions.length,
        currentIndex: 0,
        question: firstQ,
        selectedName: "",
        answered: false,
        isCorrect: false,
      });
    } catch (e) {
      console.error("猜猫猫出题失败:", e);
      this.setData({ phase: "error", errorMsg: this.data.cfg.error_load });
    }
  },

  loadQuestion() {
    const idx = this.data.currentIndex;
    const q = this.questions[idx];
    if (!q) {
      this.finishQuiz();
      return;
    }
    this.setData({
      question: q,
      selectedName: "",
      answered: false,
      isCorrect: false,
    });
  },

  // 选择某个名字
  onSelect(e) {
    if (this.data.answered) return;
    const name = e.currentTarget.dataset.name;
    const isCorrect = name === this.data.question.correctName;
    this.setData({
      selectedName: name,
      answered: true,
      isCorrect: isCorrect,
      score: isCorrect ? this.data.score + 1 : this.data.score,
    });

    // 0.9s 后进入下一题
    this._nextTimer = setTimeout(() => {
      if (this.data.currentIndex + 1 >= this.questions.length) {
        this.finishQuiz();
      } else {
        // 合并 setData：index + 下一题一起设置，避免中间帧闪烁
        const nextIdx = this.data.currentIndex + 1;
        const nextQ = this.questions[nextIdx];
        this.setData({
          currentIndex: nextIdx,
          question: nextQ,
          selectedName: "",
          answered: false,
          isCorrect: false,
        });
      }
    }, 900);
  },

  onUnload() {
    if (this._nextTimer) {
      clearTimeout(this._nextTimer);
      this._nextTimer = null;
    }
  },

  finishQuiz() {
    const score = this.data.score;
    const total = this.data.total;
    const isNewBest = saveBestRecord(score);
    const rank = this._computeRank(score, total);
    this.setData({
      phase: "result",
      bestRecord: getBestRecord(),
      isNewBest: isNewBest,
      resultRank: rank,
    });
  },

  // 根据正确率计算成绩评级
  _computeRank(score, total) {
    const rate = total > 0 ? score / total : 0;
    if (rate >= 0.9) return { emoji: "👑", title: "猫王", desc: "校园里的猫你都认识！" };
    if (rate >= 0.7) return { emoji: "🏆", title: "猫达人", desc: "妥妥的资深猫友~" };
    if (rate >= 0.5) return { emoji: "🐱", title: "猫学徒", desc: "再接再厉，继续了解猫猫吧~" };
    if (rate >= 0.3) return { emoji: "😺", title: "猫新手", desc: "多去首页看看猫猫档案吧~" };
    return { emoji: "🐾", title: "猫路新人", desc: "别灰心，多多探索校园猫咪~" };
  },

  // 再来一局
  onRestart() {
    if (this._nextTimer) {
      clearTimeout(this._nextTimer);
      this._nextTimer = null;
    }
    this.startQuiz();
  },

  // 返回
  onBack() {
    wx.navigateBack();
  },

  onShareAppMessage() {
    return {
      title: this.data.cfg.share_tip,
      path: "/pages/guessCat/guessCat",
    };
  },
});
