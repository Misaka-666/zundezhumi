// 猜猫猫排行榜操作
// op=submit: 提交成绩（仅自己的）
// op=getRank: 获取指定模式的 Top 100 排行榜
// op=getMyRank: 获取自己在指定模式的最高分和全服排名位次
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

    // 提交成绩
    if (op === 'submit') {
        const score = ctx.args?.score;
        if (score == null || typeof score !== 'number') {
            return { ok: false, errMsg: 'invalid score' };
        }
        // 按模式限定分数上下界，防止刷分
        const scoreBounds = {
            'classic': { min: -30, max: 120 },
            'endless': { min: 0, max: 9999 },
            'timed': { min: 0, max: 9999 },
        };
        const bounds = scoreBounds[mode];
        if (!bounds || score < bounds.min || score > bounds.max) {
            return { ok: false, errMsg: 'score out of range' };
        }
        await coll.insertOne({
            _openid: openid,
            mode: mode,
            score: score,
            date: new Date(),
        });
        return { ok: true };
    }

    // 获取排行榜 Top 100
    if (op === 'getRank') {
        // 查询足够多的记录再去重（同一用户可能有多条），取 500 条保证覆盖
        const { result: records } = await coll.find(
            { mode: mode },
            { sort: { score: -1, date: 1 }, limit: 500, projection: { _openid: 1, score: 1, date: 1 } }
        );
        // 去重：同一用户只保留最高分
        const seen = new Map();
        for (const r of (records || [])) {
            if (!seen.has(r._openid) || r.score > seen.get(r._openid).score) {
                seen.set(r._openid, r);
            }
        }
        const rankList = Array.from(seen.values()).sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            return new Date(a.date) - new Date(b.date);
        }).slice(0, 100);

        return { ok: true, rankList: rankList };
    }

    // 获取自己的排名
    if (op === 'getMyRank') {
        // 查自己该模式所有记录的最高分
        const { result: myRecords } = await coll.find(
            { mode: mode, _openid: openid },
            { sort: { score: -1 }, limit: 1, projection: { score: 1 } }
        );
        if (!myRecords || myRecords.length === 0) {
            return { ok: true, myBest: 0, myRank: 0 };
        }
        const myBest = myRecords[0].score;

        // 查全服比自己分数高的不同用户数（估算排名）
        // 先查所有比自己高的记录，再去重 openid
        const { result: higherRecords } = await coll.find(
            { mode: mode, score: { $gt: myBest } },
            { projection: { _openid: 1 } }
        );
        const higherOpenids = new Set();
        for (const r of (higherRecords || [])) {
            higherOpenids.add(r._openid);
        }
        // 同分但更早达成的用户也算排前面（按 date 升序），这里简化：排名 = 比自己高的不同用户数 + 1
        const myRank = higherOpenids.size + 1;

        return { ok: true, myBest: myBest, myRank: myRank };
    }

    return { ok: false, errMsg: `unknown op: ${op}` };
};
