import {
  generateQuiz, generateSingleQuestion,
  QUIZ_TOTAL, OPTION_COUNT,
  MODE_CLASSIC, MODE_ENDLESS, MODE_TIMED,
  TIMED_DURATION,
  CLASSIC_CORRECT, CLASSIC_WRONG, CLASSIC_BONUS,
  computeClassicScore,
  getBestRecord, saveBestRecord,
  submitScore,
} from "../../utils/guessCat";
import { text as textCfg } from "../../config";

Page({
  data: {
    // 页面状态：select / loading / playing / result / error
    phase: "select",
    // 当前模式
    mode: "",
    // 文案
    cfg: textCfg.guess_cat,
    // 模式列表（选择页用）
    modeList: [
      { key: MODE_CLASSIC, name: "经典模式", desc: "10 题挑战，答错不中断", icon: "🎯", best: 0 },
      { key: MODE_ENDLESS, name: "无限模式", desc: "答错即结束，挑战连胜纪录", icon: "🔥", best: 0 },
      { key: MODE_TIMED, name: "限时模式", desc: "60 秒内尽可能多答题", icon: "⏱️", best: 0 },
    ],
    // 当前题目索引（经典模式 0-based）
    currentIndex: 0,
    // 总题数（经典模式=10，无限模式=当前连胜，限时模式=已答数）
    total: QUIZ_TOTAL,
    // 当前得分 / 连胜 / 答对数
    score: 0,
    // 当前题目
    question: null,
    // 用户选择的名字
    selectedName: "",
    // 是否已选择
    answered: false,
    // 是否答对
    isCorrect: false,
    // 历史最佳
    bestRecord: 0,
    // 是否刷新最佳
    isNewBest: false,
    // 成绩评级（经典模式）
    resultRank: {},
    // 排行榜提交状态：skip/submitting/success/fail
    submitStatus: "skip",
    // 限时模式剩余秒数
    timeLeft: TIMED_DURATION,
    // 限时模式总答题数
    answeredCount: 0,
    // 错误提示
    errorMsg: "",
  },

  onLoad() {
    this._refreshModeBest();
  },

  // 刷新各模式最佳记录（选择页展示）
  _refreshModeBest() {
    const modeList = this.data.modeList.map(m => ({
      ...m,
      best: getBestRecord(m.key),
    }));
    this.setData({ modeList });
  },

  // 选择模式
  onSelectMode(e) {
    const mode = e.currentTarget.dataset.mode;
    this.startQuiz(mode);
  },

  async startQuiz(mode) {
    // 并发保护：快速双击模式卡片时忽略第二次
    if (this.data.phase === 'loading') return;
    this._clearAllTimers();
    this.questions = null;
    this._finishing = false;
    this.setData({
      mode,
      phase: "loading",
      currentIndex: 0,
      score: 0,
      total: QUIZ_TOTAL,
      selectedName: "",
      answered: false,
      isCorrect: false,
      timeLeft: TIMED_DURATION,
      answeredCount: 0,
      isNewBest: false,
      resultRank: {},
    });

    try {
      if (mode === MODE_CLASSIC) {
        // 经典模式：预生成 10 题
        const questions = await generateQuiz();
        if (!questions || questions.length === 0) {
          this.setData({ phase: "error", errorMsg: this.data.cfg.error_not_enough });
          return;
        }
        this.questions = questions;
        this.setData({
          phase: "playing",
          total: questions.length,
          currentIndex: 0,
          question: questions[0],
          bestRecord: getBestRecord(mode),
        });
      } else {
        // 无限/限时模式：逐题生成第一题
        const q = await generateSingleQuestion(null);
        if (!q) {
          this.setData({ phase: "error", errorMsg: this.data.cfg.error_not_enough });
          return;
        }
        this.questions = [q];
        this.setData({
          phase: "playing",
          total: mode === MODE_TIMED ? TIMED_DURATION : 0,
          currentIndex: 0,
          question: q,
          bestRecord: getBestRecord(mode),
        });
        // 限时模式：启动倒计时
        if (mode === MODE_TIMED) {
          this._startCountdown();
        }
      }
    } catch (e) {
      console.error("猜猫猫出题失败:", e);
      this.setData({ phase: "error", errorMsg: this.data.cfg.error_load });
    }
  },

  // 限时模式倒计时
  _startCountdown() {
    this._countdownTimer = setInterval(() => {
      const left = this.data.timeLeft - 1;
      if (left <= 0) {
        this.setData({ timeLeft: 0 });
        this._clearAllTimers();
        this.finishQuiz();
      } else {
        this.setData({ timeLeft: left });
      }
    }, 1000);
  },

  // 选择某个名字
  onSelect(e) {
    if (this.data.answered) return;
    const name = e.currentTarget.dataset.name;
    const isCorrect = name === this.data.question.correctName;
    const mode = this.data.mode;

    // 经典模式按积分制累计，无限/限时模式按答对数累计
    let newScore;
    if (mode === MODE_CLASSIC) {
      newScore = this.data.score + (isCorrect ? CLASSIC_CORRECT : CLASSIC_WRONG);
    } else {
      newScore = isCorrect ? this.data.score + 1 : this.data.score;
    }

    this.setData({
      selectedName: name,
      answered: true,
      isCorrect: isCorrect,
      score: newScore,
      answeredCount: this.data.answeredCount + 1,
    });

    // 无限模式：答错立即结束（不等反馈延迟）
    if (mode === MODE_ENDLESS && !isCorrect) {
      this._nextTimer = setTimeout(() => {
        this.finishQuiz();
      }, 900);
      return;
    }

    // 0.9s 后进入下一题
    this._nextTimer = setTimeout(() => {
      this._nextQuestion();
    }, 900);
  },

  // 进入下一题
  async _nextQuestion() {
    // phase 守卫：限时模式倒计时归零后可能触发 finishQuiz，此时 await 返回不应再操作 data
    if (this.data.phase !== 'playing') return;
    const mode = this.data.mode;

    if (mode === MODE_CLASSIC) {
      // 经典模式：从预生成题目取
      const nextIdx = this.data.currentIndex + 1;
      if (nextIdx >= this.questions.length) {
        this.finishQuiz();
        return;
      }
      this.setData({
        currentIndex: nextIdx,
        question: this.questions[nextIdx],
        selectedName: "",
        answered: false,
        isCorrect: false,
      });
    } else {
      // 无限/限时模式：逐题生成
      const excludeId = this.data.question.correctCatId;
      try {
        const q = await generateSingleQuestion(excludeId);
        // await 返回后再次检查 phase（限时模式可能在此期间倒计时归零）
        if (this.data.phase !== 'playing') return;
        if (!q) {
          this.finishQuiz();
          return;
        }
        this.setData({
          currentIndex: this.data.currentIndex + 1,
          question: q,
          selectedName: "",
          answered: false,
          isCorrect: false,
        });
      } catch (e) {
        console.error("出题失败:", e);
        this.finishQuiz();
      }
    }
  },

  onUnload() {
    this._clearAllTimers();
  },

  // 清理所有 timer
  _clearAllTimers() {
    if (this._nextTimer) {
      clearTimeout(this._nextTimer);
      this._nextTimer = null;
    }
    if (this._countdownTimer) {
      clearInterval(this._countdownTimer);
      this._countdownTimer = null;
    }
  },

  async finishQuiz() {
    // 重入保护：限时模式倒计时归零与答错延迟可能同时触发
    if (this._finishing) return;
    this._finishing = true;
    this._clearAllTimers();
    const mode = this.data.mode;
    let score = this.data.score;
    const total = this.data.total;

    // 经典模式：全对额外加 BONUS 分
    if (mode === MODE_CLASSIC && this.data.answeredCount === total && score === total * CLASSIC_CORRECT) {
      score += CLASSIC_BONUS;
      this.setData({ score });
    }

    const isNewBest = saveBestRecord(mode, score);

    let rank = {};
    if (mode === MODE_CLASSIC) {
      rank = this._computeRank(score, total);
    } else if (mode === MODE_ENDLESS) {
      rank = this._computeEndlessRank(score);
    } else if (mode === MODE_TIMED) {
      rank = this._computeTimedRank(score);
    }

    // 先显示结算页（不阻塞 UI），提交状态初始为"提交中"
    this.setData({
      phase: "result",
      bestRecord: getBestRecord(mode),
      isNewBest,
      resultRank: rank,
      submitStatus: isNewBest ? "submitting" : "skip",
    });

    // 仅刷新最佳或首次时提交到排行榜（节省云函数调用）
    if (isNewBest) {
      try {
        const res = await submitScore(mode, score);
        this.setData({ submitStatus: (res && res.ok) ? "success" : "fail" });
      } catch (e) {
        this.setData({ submitStatus: "fail" });
      }
    }
  },

  // 经典模式评级（按正确率）
  // 经典模式评级（按积分制：满分120）
  _computeRank(score, total) {
    if (score >= 110) return { emoji: "👑", title: "猫王", desc: "校园里的猫你都认识！" };
    if (score >= 80) return { emoji: "🏆", title: "猫达人", desc: "妥妥的资深猫友~" };
    if (score >= 50) return { emoji: "🐱", title: "猫学徒", desc: "再接再厉，继续了解猫猫吧~" };
    if (score >= 20) return { emoji: "😺", title: "猫新手", desc: "多去首页看看猫猫档案吧~" };
    return { emoji: "🐾", title: "猫路新人", desc: "别灰心，多多探索校园猫咪~" };
  },

  // 无限模式评级（按连胜数）
  _computeEndlessRank(streak) {
    if (streak >= 20) return { emoji: "👑", title: "猫王", desc: "神级连胜！校园猫谱倒背如流！" };
    if (streak >= 10) return { emoji: "🏆", title: "猫达人", desc: "连胜高手，稳如老猫~" };
    if (streak >= 5) return { emoji: "🐱", title: "猫学徒", desc: "不错的连胜，继续挑战~" };
    if (streak >= 2) return { emoji: "😺", title: "猫新手", desc: "刚刚热身，再战一回~" };
    return { emoji: "🐾", title: "猫路新人", desc: "别灰心，多多探索校园猫咪~" };
  },

  // 限时模式评级（按答对数）
  _computeTimedRank(score) {
    if (score >= 15) return { emoji: "👑", title: "猫王", desc: "手速惊人！猫脸识别引擎！" };
    if (score >= 10) return { emoji: "🏆", title: "猫达人", desc: "又快又准，资深猫友~" };
    if (score >= 6) return { emoji: "🐱", title: "猫学徒", desc: "速度不错，继续提升~" };
    if (score >= 3) return { emoji: "😺", title: "猫新手", desc: "慢慢来，准确率更重要~" };
    return { emoji: "🐾", title: "猫路新人", desc: "别灰心，多多探索校园猫咪~" };
  },

  // 再来一局（同一模式）
  onRestart() {
    this.startQuiz(this.data.mode);
  },

  // 返回模式选择
  onBackToSelect() {
    this._clearAllTimers();
    this.questions = null;
    this._finishing = false;
    this._refreshModeBest();
    this.setData({ phase: "select" });
  },

  // 返回上一页
  onBack() {
    wx.navigateBack();
  },

  // 去排行榜
  onGoRank() {
    wx.navigateTo({ url: "/pages/guessRank/guessRank" });
  },

  onShareAppMessage() {
    return {
      title: this.data.cfg.share_tip,
      path: "/pages/guessCat/guessCat",
    };
  },
});
