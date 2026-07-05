// equip.js … 装備効果の集計(Equip.stats())。効果適用のハブ
// DESIGN §9。SAVE.data.equipment(頭/体/足/武器)に入っているidから CONFIG.EQUIPMENT を
// 引いて fx を集計する。結果はキャッシュし、装備を変更した側(home.js)が Equip.refresh() を
// 呼んで更新する(毎フレーム再計算はしない)。

const Equip = (() => {
  const SLOTS = ["head", "body", "feet", "weapon"];

  // 乗算系(初期値1・掛け合わせ)
  const MUL_KEYS = ["defMul", "projDefMul", "knockbackMul", "coinMul"];
  // 加算系(初期値0・合計)。feverAtkはDESIGN §9の表には効果語彙として明記が無いが、
  // 「フィーバー中攻撃力+1」(楽団の燕尾服)を表現するため加算系として扱う。
  const ADD_KEYS = [
    "maxHp", "atk", "atkPerfect", "feverReq", "goodWindow", "perfectWindow",
    "shieldStart", "thorns", "jumpPlus", "airControlPlus", "magnet", "feverAtk",
  ];
  // bool系(初期値false・OR)
  const BOOL_KEYS = [
    "pierce", "blast", "feverLightning", "revive", "stealth", "missComboHalf", "lavaImmune",
  ];

  let cached = null;

  // 装備id → アイテム定義(4部位を横断して探す)
  function findItem(id) {
    if (!id) return null;
    for (const slot of SLOTS) {
      const item = (CONFIG.EQUIPMENT[slot] || []).find((it) => it.id === id);
      if (item) return item;
    }
    return null;
  }

  // 装備idが属するスロット名
  function slotOf(id) {
    if (!id) return null;
    for (const slot of SLOTS) {
      if ((CONFIG.EQUIPMENT[slot] || []).some((it) => it.id === id)) return slot;
    }
    return null;
  }

  function compute() {
    const stats = {};
    for (const k of MUL_KEYS) stats[k] = 1;
    for (const k of ADD_KEYS) stats[k] = 0;
    stats.moveDist = 1;          // 最大値集計(初期1)
    for (const k of BOOL_KEYS) stats[k] = false;
    stats.vampire = 0;           // 合計
    stats.comboAtkStep = 0;      // そのまま(最後に装備した値を採用)
    stats.comboAtkMax = 0;

    const equipment = (SAVE.data && SAVE.data.equipment) || {};
    for (const slot of SLOTS) {
      const id = equipment[slot];
      if (!id) continue;
      const item = findItem(id);
      if (!item || !item.fx) continue;
      const fx = item.fx;
      for (const k of MUL_KEYS) if (typeof fx[k] === "number") stats[k] *= fx[k];
      for (const k of ADD_KEYS) if (typeof fx[k] === "number") stats[k] += fx[k];
      if (typeof fx.moveDist === "number") stats.moveDist = Math.max(stats.moveDist, fx.moveDist);
      for (const k of BOOL_KEYS) if (fx[k]) stats[k] = true;
      if (typeof fx.vampire === "number") stats.vampire += fx.vampire;
      if (typeof fx.comboAtkStep === "number") stats.comboAtkStep = fx.comboAtkStep;
      if (typeof fx.comboAtkMax === "number") stats.comboAtkMax = fx.comboAtkMax;
    }
    return stats;
  }

  // 再計算してキャッシュを更新(装備変更・ステージ開始時に呼ぶ)
  function refresh() {
    cached = compute();
    return cached;
  }

  // 集計結果(未計算ならその場で計算)
  function stats() {
    if (!cached) refresh();
    return cached;
  }

  return { stats, refresh, findItem, slotOf };
})();
