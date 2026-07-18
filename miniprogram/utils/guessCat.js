// 猜猫猫 —— 出题数据获取与题目生成
import { signCosUrl } from "./common";
import { getCatItemMulti } from "./cat";
import { shuffle, randomInt } from "./utils";
import { getCacheItem, setCacheItem, cacheTime } from "./cache";
import { isDemoMode } from "./demo";

const app = getApp();

// 每局题数（经典模式）
export const QUIZ_TOTAL = 10;
// 选项数量（含正确答案）
export const OPTION_COUNT = 4;

// 游戏模式
export const MODE_CLASSIC = 'classic';   // 经典模式：10 题，答错不中断
export const MODE_ENDLESS = 'endless';   // 无限模式：答错即结束，统计连胜
export const MODE_TIMED = 'timed';       // 限时模式：60 秒内尽可能多答题

// 限时模式时长（秒）
export const TIMED_DURATION = 60;

// 缓存键
const CACHE_KEY_QUIZ_POOL = 'guess-cat-quiz-pool';
// 各模式最佳记录的 storage key 前缀
const BEST_RECORD_KEY = (mode) => `guess-cat-best-${mode}`;

// 获取可出题的猫 + 照片池
// 返回 [{ catId, name, photos: [photo...] }, ...]
async function getQuizPool() {
  // Demo 模式：直接用 mock 数据构造
  if (isDemoMode()) {
    return getDemoQuizPool();
  }

  // 优先取缓存
  const cached = getCacheItem(CACHE_KEY_QUIZ_POOL);
  if (cached) {
    return cached;
  }

  // 分批查询所有已审核照片（避免 find 默认上限截断，加 sort 保证分批拼接顺序稳定）
  const PAGE_SIZE = 100;
  let allPhotos = [];
  let skip = 0;
  while (true) {
    const { result: batch } = await app.mpServerless.db.collection('photo')
      .find({ verified: true }, { skip, limit: PAGE_SIZE, sort: { create_date: -1, _id: 1 } });
    if (!Array.isArray(batch) || batch.length === 0) break;
    allPhotos = allPhotos.concat(batch);
    if (batch.length < PAGE_SIZE) break;
    skip += PAGE_SIZE;
  }

  if (allPhotos.length === 0) {
    return [];
  }

  // 按 cat_id 分组
  const photosByCat = new Map();
  for (const p of allPhotos) {
    if (!p.cat_id) continue;
    if (!photosByCat.has(p.cat_id)) {
      photosByCat.set(p.cat_id, []);
    }
    photosByCat.get(p.cat_id).push(p);
  }

  const catIds = Array.from(photosByCat.keys());
  if (catIds.length === 0) {
    return [];
  }

  // 批量查询猫信息（返回数组），过滤掉 deleted 的猫
  const cats = await getCatItemMulti(catIds);
  const pool = [];
  for (const cat of cats) {
    if (!cat || cat.deleted) continue;
    pool.push({
      catId: cat._id,
      name: cat.name,
      photos: photosByCat.get(cat._id),
    });
  }

  // 精简缓存结构：只存出题必需字段，避免完整 photo 对象撑爆 wx storage 1MB 单 key 限制
  const slimPool = pool.map(c => ({
    catId: c.catId,
    name: c.name,
    photos: c.photos.map(p => ({
      photo_compressed: p.photo_compressed,
      photo_id: p.photo_id,
    })),
  }));
  try {
    setCacheItem(CACHE_KEY_QUIZ_POOL, slimPool, cacheTime.catItem);
  } catch (e) {
    console.warn('猜猫猫题库缓存写入失败（可能超 storage 限制），不影响游戏:', e.message);
  }
  return slimPool;
}

// 从照片池中随机选一张并签名
async function pickAndSignPhoto(photos) {
  if (!photos || photos.length === 0) return null;
  const idx = randomInt(0, photos.length);
  const photo = photos[idx];
  const urlToSign = photo.photo_compressed || photo.photo_id;
  if (!urlToSign) return null;
  return await signCosUrl(urlToSign);
}

// 生成一道题
// 返回 { photoUrl, correctName, correctCatId, options: [name...] }
function generateQuestion(pool) {
  if (!pool || pool.length < OPTION_COUNT) {
    return null;
  }

  // 随机选目标猫
  const targetIdx = randomInt(0, pool.length);
  const target = pool[targetIdx];

  // 选干扰项：从其余猫中随机选 OPTION_COUNT-1 个名字（按 name 去重，避免同名猫导致选项重复）
  const others = pool.filter((_, i) => i !== targetIdx);
  const seenNames = new Set([target.name]);
  const distractors = [];
  for (const d of shuffle(others)) {
    if (!seenNames.has(d.name)) {
      seenNames.add(d.name);
      distractors.push(d);
      if (distractors.length >= OPTION_COUNT - 1) break;
    }
  }

  // 干扰项不足时（同名猫过多）无法凑齐 4 个不同选项，跳过此题
  if (distractors.length < OPTION_COUNT - 1) {
    return null;
  }

  const options = shuffle([target.name, ...distractors.map(d => d.name)]);

  return {
    photoUrl: null, // 照片需异步签名，由调用方填充
    photos: target.photos,
    correctName: target.name,
    correctCatId: target.catId,
    options: options,
  };
}

// 生成一整局题目（含照片签名）
// 返回 [question, ...] 或 null（猫数不足）
async function generateQuiz() {
  const pool = await getQuizPool();
  if (!pool || pool.length < OPTION_COUNT) {
    return null;
  }

  const questions = [];
  // 最多尝试 3 倍题数，防止照片字段全缺导致无限重试
  const maxAttempts = QUIZ_TOTAL * 3;
  let attempts = 0;

  while (questions.length < QUIZ_TOTAL && attempts < maxAttempts) {
    attempts++;
    // 尽量避免连续重复同一只猫，题库够大时排除上一只
    let availPool = pool;
    let useFallback = false;
    if (pool.length > OPTION_COUNT && questions.length > 0) {
      const lastId = questions[questions.length - 1].correctCatId;
      availPool = pool.filter(c => c.catId !== lastId);
      if (availPool.length < OPTION_COUNT) {
        availPool = pool;
      } else {
        useFallback = true; // 排除后仍够 4 只，但如果出题失败需回退完整 pool
      }
    }

    let q = generateQuestion(availPool);
    if (!q && useFallback) {
      // 排除上一只猫后干扰项不足（同名猫过多），回退完整 pool 重试
      q = generateQuestion(pool);
    }
    if (!q) {
      // 完整 pool 也无法出题（同名猫占比过高），跳过本次尝试
      continue;
    }

    // 照片签名，若照片字段全缺则跳过此题重选
    q.photoUrl = await pickAndSignPhoto(q.photos);
    delete q.photos;
    if (!q.photoUrl) {
      continue;
    }

    questions.push(q);
  }

  return questions.length > 0 ? questions : null;
}

// 逐题生成单道题目（含照片签名）—— 供无限/限时模式按需出题
// excludeCatId: 避免连续重复同一只猫（可选）
// 返回 question 对象或 null
async function generateSingleQuestion(excludeCatId) {
  const pool = await getQuizPool();
  if (!pool || pool.length < OPTION_COUNT) {
    return null;
  }

  // 连续去重 + 回退逻辑（与 generateQuiz 一致）
  let availPool = pool;
  let useFallback = false;
  if (pool.length > OPTION_COUNT && excludeCatId) {
    availPool = pool.filter(c => c.catId !== excludeCatId);
    if (availPool.length < OPTION_COUNT) {
      availPool = pool;
    } else {
      useFallback = true;
    }
  }

  let q = generateQuestion(availPool);
  if (!q && useFallback) {
    q = generateQuestion(pool);
  }
  if (!q) return null;

  q.photoUrl = await pickAndSignPhoto(q.photos);
  delete q.photos;
  if (!q.photoUrl) return null;

  return q;
}

// 读取历史最佳记录（按模式区分）
function getBestRecord(mode) {
  return wx.getStorageSync(BEST_RECORD_KEY(mode || MODE_CLASSIC)) || 0;
}

// 写入历史最佳记录（仅当更高时更新）
function saveBestRecord(mode, score) {
  const key = BEST_RECORD_KEY(mode || MODE_CLASSIC);
  const best = wx.getStorageSync(key) || 0;
  if (score > best) {
    wx.setStorageSync(key, score);
    return true;
  }
  return false;
}

// ===== Demo 模式数据 =====
function getDemoQuizPool() {
  const { DEMO_CATS, DEMO_PHOTOS } = require('./demo');
  const pool = [];
  for (const cat of DEMO_CATS) {
    const catPhotos = DEMO_PHOTOS.filter(p => p.cat_id === cat._id);
    if (catPhotos.length > 0) {
      pool.push({
        catId: cat._id,
        name: cat.name,
        photos: catPhotos,
      });
    }
  }
  return pool;
}

module.exports = {
  QUIZ_TOTAL,
  OPTION_COUNT,
  MODE_CLASSIC,
  MODE_ENDLESS,
  MODE_TIMED,
  TIMED_DURATION,
  getQuizPool,
  generateQuestion,
  generateQuiz,
  generateSingleQuestion,
  getBestRecord,
  saveBestRecord,
};
