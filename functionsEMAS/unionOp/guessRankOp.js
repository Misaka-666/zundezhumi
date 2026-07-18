// 猜猫猫排行榜操作
// op=submit: 提交成绩
//   - classic（经典）：累加到已有记录（$inc），每用户只有一条记录
//   - endless/timed（无限/限时）：插入新记录，查询时取单局最高
// op=getRank: 获取指定模式的 Top 100 排行榜
//   - classic：按累计总分降序
//   - endless/timed：按单局最高分降序
// op=getMyRank: 获取自己在指定模式的最佳成绩和全服排名位次
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
        if (score == null || typeof score !== 'number') {
            return { ok: false, errMsg: 'invalid score' };
        }
        const bounds = scoreBounds[mode];
        if (!bounds || score < bounds.min || score > bounds.max) {
            return { ok: false, errMsg: 'score out of range' };
        }

        if (isClassic) {
            // 经典模式：累加到已有记录（upsert）
            // 每用户每模式只保留一条记录，score 为累计总分
            const existing = await coll.findOne({ _openid: openid, mode: mode });
            if (existing && existing.result) {
                // 已有记录，原子累加
                await coll.updateOne(
                    { _openid: openid, mode: mode },
                    { $inc: { score: score }, $set: { lastUpdate: new Date() } }
                );
            } else {
                // 新建记录
                await coll.insertOne({
                    _openid: openid,
                    mode: mode,
                    score: score,
                    date: new Date(),
                    lastUpdate: new Date(),
                });
            }
        } else {
            // 无限/限时模式：每次插入新记录（单局成绩）
            await coll.insertOne({
                _openid: openid,
                mode: mode,
                score: score,
                date: new Date(),
            });
        }
        return { ok: true };
    }

    // 获取排行榜 Top 100
    if (op === 'getRank') {
        if (isClassic) {
            // 经典模式：每用户一条记录，直接按 score 降序
            const { result: records } = await coll.find(
                { mode: mode },
                { sort: { score: -1, lastUpdate: 1 }, limit: 100, projection: { _openid: 1, score: 1 } }
            );
            const rankList = (records || []).map(r => ({ _openid: r._openid, score: r.score }));
            return { ok: true, rankList: rankList };
        } else {
            // 无限/限时模式：查 500 条，按用户去重取最高
            const { result: records } = await coll.find(
                { mode: mode },
                { sort: { score: -1, date: 1 }, limit: 500, projection: { _openid: 1, score: 1, date: 1 } }
            );
            const seen = new Map();
            for (const r of (records || [])) {
                if (!seen.has(r._openid) || r.score > seen.get(r._openid).score) {
                    seen.set(r._openid, r);
                }
            }
            const rankList = Array.from(seen.values()).sort((a, b) => {
                if (b.score !== a.score) return b.score - a.score;
                return new Date(a.date) - new Date(b.date);
            }).slice(0, 100).map(r => ({ _openid: r._openid, score: r.score }));
            return { ok: true, rankList: rankList };
        }
    }

    // 获取自己的排名
    if (op === 'getMyRank') {
        if (isClassic) {
            // 经典模式：累计总分
            const { result: myRecord } = await coll.findOne({ _openid: openid, mode: mode });
            if (!myRecord) {
                return { ok: true, myBest: 0, myRank: 0 };
            }
            const myBest = myRecord.score;
            // 统计比自己高的用户数
            const higherCount = await coll.count({ mode: mode, score: { $gt: myBest } });
            const myRank = (higherCount.result || 0) + 1;
            return { ok: true, myBest: myBest, myRank: myRank };
        } else {
            // 无限/限时模式：单局最高
            const { result: myRecords } = await coll.find(
                { mode: mode, _openid: openid },
                { sort: { score: -1 }, limit: 1, projection: { score: 1 } }
            );
            if (!myRecords || myRecords.length === 0) {
                return { ok: true, myBest: 0, myRank: 0 };
            }
            const myBest = myRecords[0].score;
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
            return { ok: true, myBest: myBest, myRank: myRank };
        }
    }

    return { ok: false, errMsg: `unknown op: ${op}` };
};