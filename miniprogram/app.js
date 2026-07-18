import { checkUpdateVersion, getDateWithDiffHours } from './utils/utils';
import { app_version } from "./config";
import { ensureCos } from './utils/common';
import { app_id, space_id, space_secret, space_endpoint } from './config'
import eventBus from './utils/eventBus';
import { createMockMpServerless } from './utils/demo';
import { injectEmas } from './utils/emas';

let mpServerless;
let demoMode = false;

// 尝试加载 EMAS SDK（npm 包可能未安装）
try {
  var MPServerless = require('@alicloud/mpserverless-sdk');
  mpServerless = new MPServerless({
    uploadFile: wx.uploadFile,
    request: wx.request,
    getAuthCode: wx.login,
    getFileInfo: wx.getFileInfo,
    getImageInfo: wx.getImageInfo,
  }, {
    appId: app_id,
    spaceId: space_id,
    clientSecret: space_secret,
    endpoint: space_endpoint,
  });
  mpServerless.init();
  console.log('EMAS 初始化成功');
  // 全局调大 transport 默认超时：SDK 默认仅 5s，冷启动/云函数首请求常超时，
  // 导致首页 getGlobalSettings 重试 3 次累计十几秒才出数据。
  // 调到 15s 一次就能兜住冷启动，catFace 仍会单独临时调到 30s。
  try {
    if (mpServerless.transport && typeof mpServerless.transport.setTimeout === 'function') {
      mpServerless.transport.setTimeout(15000);
    }
  } catch (e) {
    console.warn('设置 transport 超时失败:', e.message);
  }
  // 注入 COS 签名：覆盖 findOne/find，对返回数据里的 COS URL 自动签名
  try {
    injectEmas(mpServerless);
    console.log('EMAS 原型注入成功');
  } catch (e) {
    console.warn('EMAS 原型注入失败:', e.message);
  }
} catch (e) {
  console.warn('EMAS SDK 未安装或初始化失败，进入离线 Demo 模式:', e.message);
  mpServerless = createMockMpServerless();
  demoMode = true;
}

// Demo 模式：全局拦截 wx.downloadFile / wx.saveFile / wx.getFileSystemManager 等
// 避免任何代码路径产生 "downloadFile:fail url not in domain list" 错误
if (demoMode) {
  const _downloadFile = wx.downloadFile;
  wx.downloadFile = function (options) {
    const url = options.url || '';
    if (url.startsWith('/') || !url.startsWith('http')) {
      console.log('[Demo] skip downloadFile for local path:', url);
      options.success && options.success({ tempFilePath: url, statusCode: 200 });
      return;
    }
    console.log('[Demo] skip downloadFile for:', url);
    options.success && options.success({ tempFilePath: url, statusCode: 200 });
  };
}

App({
  async onLaunch() {
    if (!demoMode) {
      try {
        this.cos = await ensureCos();
      } catch (e) {
        console.warn('COS 初始化失败:', e.message);
      }
    }

    checkUpdateVersion();
    this.clearCache();

    this.globalData = {
      version: app_version,
      eventBus: eventBus,
      demoMode: demoMode,
    };
  },

  clearCache() {
    let clearDay = wx.getStorageSync('clear-all-cache');
    if (!clearDay || (new Date(clearDay)) < (new Date())) {
      console.log("清理所有缓存数据");
      wx.clearStorageSync();
      wx.setStorageSync('clear-all-cache', getDateWithDiffHours(48));
    } else {
      console.log("缓存仍然有效，过期时间", new Date(clearDay));
    }
  },
  mpServerless: mpServerless,
  cos: null,
});
