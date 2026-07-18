// 猜猫猫排行榜操作
// op=submit: 提交成绩
//   - classic（经典）：原子 upsert 累加，每用户只有一条记录
//   - endless/timed（无限/限时）：插入新记录，查询时取单局最高
// op=getRank: 获取指定模式的 Top 100 排行榜
//   - classic：按累计总分降序（去重兜底）
//   - endless/timed：按单局最高分降序
// op=getMyRank: 获取自己在指定模式的最佳成绩和全服排名位次
//   - classic：累计总分（累加所有记录求和，兼容历史脏数据）
//   - endless/timed：单局最高
module.exports = async (ctx) => {
    const openid = ctx.args?.openid;
    if (!openid) {
        return { ok: false, errMsg: 'no openid' };
    }

    const op = ctx.args?.op;
    const mode = ctx.args?.mode;
    if (!mode) {
        return { ok: false, errMsg: 'no mode' };
    }

    const db = ctx.mpserverless.db;
    const coll = db.collection('guess_rank');

    const isClassic = mode === 'classic';

    // 分数上下界（防刷分）
    const scoreBounds = {
        'classic': { min: -30, max: 120 },
        'endless': { min: 0, max: 9999 },
        'timed': { min: 0, max: 9999 },
    };

    // 提交成绩
    if (op === 'submit') {
        const score = ctx.args?.score;
        if (score == null || !Number.isFinite(score)) {
            return { ok: false, errMsg: 'invalid score' };
        }
        const bounds = scoreBounds[mode];
        if (!bounds || score < bounds.min || score > bounds.max) {
            return { ok: false, errMsg: 'score out of range' };
        }

        if (isClassic) {
            // 经典模式：原子 upsert 累加
            // findOneAndUpdate + upsert=true 确保并发安全，不会产生重复记录
            try {
                await coll.findOneAndUpdate(
                    { _openid: openid, mode: mode },
                    {
                        $inc: { score: score, playCount: 1 },
                        $set: { lastUpdate: new Date() },
                        $setOnInsert: { _openid: openid, mode: mode, date: new Date() }
                    },
                    { upsert: true }
                );
            } catch (e) {
                // EMAS findOneAndUpdate 不支持 upsert 时，回退到非原子方案
                // 查找→更新或插入（insertOne 失败时重试 updateOne 防并发重复）
                const existing = await coll.find(
                    { _openid: openid, mode: mode },
                    { limit: 1, projection: { score: 1 } }
                );
                if (existing && existing.result && existing.result.length > 0) {
                    await coll.updateOne(
                        { _openid: openid, mode: mode },
                        { $inc: { score: score, playCount: 1 }, $set: { lastUpdate: new Date() } }
                    );
                } else {
                    try {
                        await coll.insertOne({
                            _openid: openid,
                            mode: mode,
                            score: score,
                            playCount: 1,
                            date: new Date(),
                            lastUpdate: new Date(),
                        });
                    } catch (insertErr) {
                        // 并发时另一请求可能已插入，回退到累加
                        await coll.updateOne(
                            { _openid: openid, mode: mode },
                            { $inc: { score: score, playCount: 1 }, $set: { lastUpdate: new Date() } }
                        );
                    }
                }
            }
        } else {
            // 无限/限时模式：每次插入新记录（单局成绩），playCount 在查询时按记录数统计
            try {
                await coll.insertOne({
                    _openid: openid,
                    mode: mode,
                    score: score,
                    date: new Date(),
                });
            } catch (insertErr) {
                return { ok: false, errMsg: 'insert failed: ' + (insertErr.message || 'unknown') };
            }
        }
        return { ok: true };
    }

    // 获取排行榜 Top 100
    if (op === 'getRank') {
        // 两种模式都查 500 条再按 _openid 去重，兜底防重复记录
        const { result: records } = await coll.find(
            { mode: mode },
            { sort: { score: -1, date: 1 }, limit: 500, projection: { _openid: 1, score: 1, date: 1, playCount: 1 } }
        );
        const seen = new Map();
        const playCountMap = new Map(); // 无限/限时模式用：统计每用户记录数
        const classicTotalMap = new Map(); // 经典模式用：累加多条脏数据求总分
        const classicPlayMap = new Map(); // 经典模式用：累加 playCount（与 getMyRank 一致）
        for (const r of (records || [])) {
            if (isClassic) {
                // 经典模式：累加 score 和 playCount（兼容脏数据，与 getMyRank 保持一致）
                classicTotalMap.set(r._openid, (classicTotalMap.get(r._openid) || 0) + (r.score || 0));
                classicPlayMap.set(r._openid, (classicPlayMap.get(r._openid) || 0) + (r.playCount || 1));
                // 取最新日期作为排序依据
                if (!seen.has(r._openid) || new Date(r.date) > new Date(seen.get(r._openid).date)) {
                    seen.set(r._openid, r);
                }
            } else {
                // 无限/限时：取单局最高
                playCountMap.set(r._openid, (playCountMap.get(r._openid) || 0) + 1);
                if (!seen.has(r._openid) || r.score > seen.get(r._openid).score) {
                    seen.set(r._openid, r);
                }
            }
        }
        const rankList = Array.from(seen.values()).sort((a, b) => {
            const aScore = isClassic ? classicTotalMap.get(a._openid) : a.score;
            const bScore = isClassic ? classicTotalMap.get(b._openid) : b.score;
            if (bScore !== aScore) return bScore - aScore;
            return new Date(a.date) - new Date(b.date);
        }).slice(0, 100).map(r => ({
            _openid: r._openid,
            score: isClassic ? classicTotalMap.get(r._openid) : r.score,
            playCount: isClassic ? (classicPlayMap.get(r._openid) || 1) : (playCountMap.get(r._openid) || 1)
        }));
        return { ok: true, rankList: rankList };
    }

    // 获取自己的排名
    if (op === 'getMyRank') {
        // 查自己的所有记录（兼容多条脏数据）
        const { result: myRecords } = await coll.find(
            { mode: mode, _openid: openid },
            { sort: { score: -1 }, projection: { score: 1, date: 1, playCount: 1 } }
        );
        if (!myRecords || myRecords.length === 0) {
            return { ok: true, myBest: 0, myRank: 0, myPlayCount: 0 };
        }
        let myBest;
        let myPlayCount;
        if (isClassic) {
            // 经典模式：累加所有记录的 score 求总分（兼容脏数据）
            myBest = myRecords.reduce((sum, r) => sum + (r.score || 0), 0);
            myPlayCount = myRecords.reduce((sum, r) => sum + (r.playCount || 1), 0);

            // 经典排名：查所有用户记录，按 _openid 汇总累加总分，再统计比自己高的
            const { result: allRecords } = await coll.find(
                { mode: mode },
                { sort: { score: -1 }, limit: 500, projection: { _openid: 1, score: 1 } }
            );
            const userTotalMap = new Map();
            for (const r of (allRecords || [])) {
                userTotalMap.set(r._openid, (userTotalMap.get(r._openid) || 0) + (r.score || 0));
            }
            let higherCount = 0;
            for (const [uid, total] of userTotalMap) {
                if (uid === openid) continue;
                if (total > myBest) higherCount++;
            }
            return { ok: true, myBest: myBest, myRank: higherCount + 1, myPlayCount: myPlayCount };
        } else {
            // 无限/限时：取单局最高
            myBest = myRecords[0].score;
            myPlayCount = myRecords.length;
        }

        // 查比自己高的不同用户
        const { result: higherRecords } = await coll.find(
            { mode: mode, score: { $gt: myBest } },
            { projection: { _openid: 1 } }
        );
        const higherOpenids = new Set();
        for (const r of (higherRecords || [])) {
            higherOpenids.add(r._openid);
        }
        const myRank = higherOpenids.size + 1;
        return { ok: true, myBest: myBest, myRank: myRank, myPlayCount: myPlayCount };
    }

    return { ok: false, errMsg: `unknown op: ${op}` };
};