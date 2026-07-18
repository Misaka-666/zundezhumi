import { getRankList, getMyRank, MODE_CLASSIC, MODE_ENDLESS, MODE_TIMED } from "../../utils/guessCat";
import { fillUserInfo } from "../../utils/user";
import { text as textCfg } from "../../config";

const MODE_TABS = [
  { key: MODE_CLASSIC, name: "经典", unit: "分" },
  { key: MODE_ENDLESS, name: "无限", unit: "连胜" },
  { key: MODE_TIMED, name: "限时", unit: "题" },
];

Component({
  data: {
    cfg: textCfg.guess_cat,
    tabs: MODE_TABS,
    activeTab: 0,
    currentMode: MODE_CLASSIC,
    rankList: [],
    myRank: 0,
    myBest: 0,
    myPlayCount: 0,
    loading: true,
    loaded: false,
  },

  lifetimes: {
    attached() {
      // 首次挂载时加载
      this.loadRank(MODE_CLASSIC);
    },
  },

  methods: {
    // 供父页面调用：切换到该 tab 时刷新
    reloadData() {
      const mode = this.data.currentMode || MODE_CLASSIC;
      this.loadRank(mode);
    },

    async loadRank(mode) {
      this.setData({ loading: true, rankList: [] });
      try {
        const [rankList, myRankInfo] = await Promise.all([
          getRankList(mode),
          getMyRank(mode),
        ]);

        const items = rankList.map(r => ({ ...r, userInfo: undefined }));
        await fillUserInfo(items, '_openid', 'userInfo');

        this.setData({
          rankList: items,
          myRank: myRankInfo.myRank || 0,
          myBest: myRankInfo.myBest || 0,
          myPlayCount: myRankInfo.myPlayCount || 0,
          loading: false,
          loaded: true,
        });
      } catch (e) {
        console.error("加载排行榜失败:", e);
        this.setData({ loading: false, loaded: true });
      }
    },

    onSwitchTab(e) {
      const idx = e.currentTarget.dataset.idx;
      const mode = MODE_TABS[idx].key;
      this.setData({ activeTab: idx, currentMode: mode });
      this.loadRank(mode);
    },
  },
});