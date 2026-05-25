// 处理反馈
import { formatDate } from "../../../utils/utils";
import { requestNotice, getMsgTplId } from "../../../utils/msg";
import { checkAuth, fillUserInfo } from "../../../utils/user";
import api from "../../../utils/cloudApi";

const step = 6;
const app = getApp();

Page({

  /**
   * 页面的初始数据
   */
  data: {
    feedbacks: [],
    total: 0,
    checkHistory: false,
  },

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad: async function (options) {
    if (await checkAuth(this, 1)) {
      this.reload();
      app.globalData.eventBus.$on('feedbackUpdated', this.handleFeedbackUpdate);
    }
  },

  onUnload: function() {
    app.globalData.eventBus.$off('feedbackUpdated', this.handleFeedbackUpdate);
  },

  handleFeedbackUpdate: function(payload) {
    console.log('收到反馈更新事件:', payload);

    var feedbacks = this.data.feedbacks;
    var updates = {};
    for (var i = 0; i < feedbacks.length; i++) {
      if (feedbacks[i]._id === payload.id) {
        updates["feedbacks[" + i + "].replied"] = true;
        updates["feedbacks[" + i + "].replyDate"] = new Date();
        updates["feedbacks[" + i + "].replyDateStr"] = formatDate(new Date(), "yyyy-MM-dd hh:mm:ss");
        updates["feedbacks[" + i + "].replyInfo"] = payload.replyInfo;
        break;
      }
    }
    if (Object.keys(updates).length > 0) {
      this.setData(updates);
    }
  },

  async loadFeedbacks() {
    const nowLoaded = this.data.feedbacks.length;
    var { result: feedbacks } = await app.mpServerless.db.collection('feedback').find({ dealed: this.data.checkHistory }, { sort: { openDate: -1 }, skip: nowLoaded, limit: step })
    console.log("[loadFeedbacks] -", feedbacks);
    await fillUserInfo(feedbacks, "openid", "userInfo");
    for (let i = 0; i < feedbacks.length; ++i) {
      if (feedbacks[i].cat_id != undefined) {
        const { result: cat } = await app.mpServerless.db.collection('cat').findOne({ _id: feedbacks[i].cat_id }, {
          projection: { name: 1, campus: 1 }
        })
        feedbacks[i].cat = cat;
      }
      feedbacks[i].openDateStr = formatDate(feedbacks[i].openDate, "yyyy-MM-dd hh:mm:ss");
      feedbacks[i].replied = feedbacks[i].hasOwnProperty('replyDate');
      if (feedbacks[i].replied) {
        feedbacks[i].replyDateStr = formatDate(feedbacks[i].replyDate, "yyyy-MM-dd hh:mm:ss");
      }
    }
    var oldLen = this.data.feedbacks.length;
    this.data.feedbacks.push(...feedbacks);
    var updates = {};
    for (var k = oldLen; k < this.data.feedbacks.length; k++) {
      updates["feedbacks[" + k + "]"] = this.data.feedbacks[k];
    }
    this.setData(updates);
  },

  async refreshStatus() {
    await this.requestSubscribeMessage();
    await this.reload();
  },

  async reload() {
    wx.showLoading({
      title: '加载中...',
    });
    var { result: fbRes } = await app.mpServerless.db.collection('feedback').count({
      dealed: this.data.checkHistory
    });

    console.log("[reload] - feedbacks: ", fbRes);
    this.setData({
      total: fbRes.total,
    });
    this.data.feedbacks = [];
    await this.loadFeedbacks();
    wx.hideLoading();
  },

  async requestSubscribeMessage() {
    const notifyChkFeedbackTplId = getMsgTplId("notifyChkFeedback");
    wx.getSetting({
      withSubscriptions: true,
      success: res => {
        console.log("[requestSubscribeMessage] - subscribeSet:", res);
        if ('subscriptionsSetting' in res) {
          if (!(notifyChkFeedbackTplId in res['subscriptionsSetting'])) {
            requestNotice('notifyChkFeedback');
          } else if (res.subscriptionsSetting[notifyChkFeedbackTplId] === 'reject') {
            // console.log("已拒绝");
          } else if (res.subscriptionsSetting[notifyChkFeedbackTplId] === 'accept') {
            console.log('[requestSubscribeMessage] - 重新请求下个一次性订阅');
            requestNotice('notifyChkFeedback');
          }
        }
      },
      complete: res => {
        console.log("[requestSubscribeMessage] - complete:", res);
      }
    })
  },

  async onReachBottom() {
    if (this.data.feedbacks.length == this.data.total) {
      wx.showToast({
        title: '已无更多反馈',
        icon: 'none',
        duration: 500
      });
      return;
    }
    wx.showLoading({
      title: '加载更多反馈..',
      mask: true
    });
    await this.loadFeedbacks();
    wx.hideLoading();
  },

  async bindCheck(e) {
    const feedback = e.currentTarget.dataset.feedback;
    const modalRes = await wx.showModal({
      title: '提示',
      content: '确定已完成该反馈处理？',
    })
    if (!modalRes.confirm) {
      return;
    }

    console.log('[bindCheck] - 确认反馈处理');
    await api.curdOp({
      operation: 'update',
      collection: "feedback",
      item_id: feedback._id,
      data: {
        dealed: true,
        dealDate: api.getDate()
      }
    });

    console.log("[bindCheck] - 反馈已处理：" + feedback._id);
    const feedbacks = this.data.feedbacks;
    const new_feedbacks = feedbacks.filter((fb) => {
      return fb._id != feedback._id;
    });
    this.setData({
      feedbacks: new_feedbacks,
      total: this.data.total - 1
    });
    wx.showToast({
      title: '反馈已处理',
    });
  },

  bindCopy(e) {
    const item = e.currentTarget.dataset.feedback;
    wx.setClipboardData({
      data: (item.cat ? ("所属猫猫：" + item.cat.name + '（' + item.cat.campus + '）') : '反馈来源：关于页-信息反馈') + "\n反馈内容：" + item.feedbackInfo + "\n反馈人：" + item.userInfo.nickName + "\n联系方式：" + (item.contactInfo || "对方没有留下联系方式") + "\n反馈时间：" + item.openDateStr,
    });
  },

  toCatDetail(e) {
    const cat_id = e.currentTarget.dataset.cat_id;
    wx.navigateTo({
      url: '/pages/genealogy/detailCat/detailCat?cat_id=' + cat_id,
    })
  },

  toCatManage(e) {
    const cat_id = e.currentTarget.dataset.cat_id;
    wx.navigateTo({
      url: '/pages/manage/catManage/catManage?cat_id=' + cat_id + '&activeTab=info',
    });
  },

  toReply(e) {
    const fb_id = e.currentTarget.dataset.fbid;
    wx.navigateTo({
      url: '/pages/manage/replyFeedback/replyFeedback?fb_id=' + fb_id,
    })
  },

  switchHistory(event) {
    this.data.checkHistory = !this.data.checkHistory;
    this.reload();
    this.setData({
      checkHistory: this.data.checkHistory
    });
  }
})