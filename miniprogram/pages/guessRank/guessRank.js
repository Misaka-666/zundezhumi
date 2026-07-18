import { getRankList, getMyRank, MODE_CLASSIC, MODE_ENDLESS, MODE_TIMED } from "../../utils/guessCat";
import { fillUserInfo } from "../../utils/user";
import { text as textCfg } from "../../config";

const MODE_TABS = [
  { key: MODE_CLASSIC, name: "经典", unit: "分" },
  { key: MODE_ENDLESS, name: "无限", unit: "连胜" },
  { key: MODE_TIMED, name: "限时", unit: "题" },
];

Page({
  data: {
    cfg: textCfg.guess_cat,
    tabs: MODE_TABS,
    activeTab: 0,
    currentMode: MODE_CLASSIC,
    rankList: [],
    myRank: 0,
    myBest: 0,
    loading: true,
  },

  onLoad() {
    this.loadRank(MODE_CLASSIC);
  },

  async loadRank(mode) {
    this.setData({ loading: true, rankList: [] });
    try {
      console.log('[猜猫猫排行榜] 加载模式:', mode);
      const [rankList, myRankInfo] = await Promise.all([
        getRankList(mode),
        getMyRank(mode),
      ]);
      console.log('[猜猫猫排行榜] rankList:', rankList.length, '条记录');
      console.log('[猜猫猫排行榜] myRankInfo:', JSON.stringify(myRankInfo));

      // 填充用户信息（头像+昵称）
      const items = rankList.map(r => ({ ...r, userInfo: undefined }));
      await fillUserInfo(items, '_openid', 'userInfo');

      this.setData({
        rankList: items,
        myRank: myRankInfo.myRank || 0,
        myBest: myRankInfo.myBest || 0,
        loading: false,
      });
    } catch (e) {
      console.error("加载排行榜失败:", e);
      this.setData({ loading: false });
    }
  },

  onSwitchTab(e) {
    const idx = e.currentTarget.dataset.idx;
    const mode = MODE_TABS[idx].key;
    this.setData({ activeTab: idx, currentMode: mode });
    this.loadRank(mode);
  },

  onBack() {
    wx.navigateBack();
  },

  onShareAppMessage() {
    return {
      title: "猜猫猫排行榜",
      path: "/pages/guessRank/guessRank",
    };
  },
});
