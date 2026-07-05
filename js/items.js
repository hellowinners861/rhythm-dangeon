// items.js … 拾得アイテム・コイン
// DESIGN §8/§9。Step6でコインを実装。Step7でハート/シールド/ブースト(拾得アイテム)を追加。
// 座標系は player.js/enemies.js と同じ tx,ty(タイル=真実)。コイン・アイテムの浮遊演出のみ
// rAF の dt で行う(描画専用。拍・タイミング計算には使わない)。

const Items = (() => {
  const TILE = CONFIG.TILE;
  const VW = CONFIG.VIEW.W, VH = CONFIG.VIEW.H;

  // 拾得アイテム種別のアイコン(絵文字。DESIGN §8)
  const ICONS = { heart: "💗", shield: "🛡", boost: "👟" };

  let coins = [];       // { tx, ty, alive, bob }
  let pickups = [];     // { tx, ty, kind("heart"|"shield"|"boost"), alive, bob }
  let stageCoins = 0;   // このステージで獲得した枚数(整数・持ち帰り計算の元)
  let coinFrac = 0;     // coinMul適用時の端数(1未満)。貯めて1以上になったら繰り上げる
  let effects = [];     // 回収エフェクト
  let t = 0;            // 浮遊演出用の経過秒

  function getStats() {
    return (typeof Equip !== "undefined") ? Equip.stats() : { coinMul: 1, magnet: 0 };
  }

  // レベルのスポーン候補(C=コイン/I=拾得アイテム)を実体にする。
  // rngFn: アイテム種別(ハート/シールド/ブースト)の抽選に使うシード乱数(省略時Math.random)。
  function init(level, rngFn) {
    coins = [];
    pickups = [];
    stageCoins = 0;
    coinFrac = 0;
    effects = [];
    t = 0;
    if (!level || !level.spawns) return;
    const rand = rngFn || Math.random;
    const rates = CONFIG.ITEMS.DROP_RATES; // {heart, shield, boost}(合計1)
    for (const s of level.spawns) {
      if (s.type === "C") {
        coins.push({ tx: s.tx, ty: s.ty, alive: true, bob: Math.random() * Math.PI * 2 });
      } else if (s.type === "I") {
        const r = rand();
        let kind;
        if (r < rates.heart) kind = "heart";
        else if (r < rates.heart + rates.shield) kind = "shield";
        else kind = "boost";
        pickups.push({ tx: s.tx, ty: s.ty, kind, alive: true, bob: Math.random() * Math.PI * 2 });
      }
    }
  }

  // 敵撃破時のコインドロップ(Enemies.damageAtから呼ばれる)。tx,tyへn枚まとめて生成する。
  function spawnCoin(tx, ty, n) {
    for (let i = 0; i < n; i++) {
      coins.push({ tx, ty, alive: true, bob: Math.random() * Math.PI * 2 });
    }
  }

  // 回収(coinMulを乗じて端数は累積・切り捨て)
  function collect(coinMul, tx, ty) {
    coinFrac += 1 * coinMul;
    const gained = Math.floor(coinFrac);
    if (gained > 0) {
      coinFrac -= gained;
      stageCoins += gained;
    }
    effects.push({ x: tx, y: ty, t: 0, dur: 0.35 });
    if (typeof SFX !== "undefined" && SFX.coin) SFX.coin();
  }

  // 拾得アイテムの効果適用(ハート/シールド/ブースト)。DESIGN §8・Step7。
  function collectPickup(kind, tx, ty) {
    if (typeof Player !== "undefined") {
      if (kind === "heart") Player.heal(CONFIG.ITEMS.HEAL_AMOUNT);
      else if (kind === "shield" && Player.addShield) Player.addShield(CONFIG.ITEMS.SHIELD_ADD);
      else if (kind === "boost" && Player.setBoost) Player.setBoost(CONFIG.ITEMS.BOOST_BEATS);
    }
    effects.push({ x: tx, y: ty, t: 0, dur: 0.4, icon: ICONS[kind] });
    if (typeof SFX !== "undefined" && SFX.coin) SFX.coin(); // 軽い上昇音を流用(コインと音違いは不要)
  }

  // 毎フレーム更新:プレイヤーのタイル(+magnet半径以内)のコインを回収する。
  // 拾得アイテム(ハート/シールド/ブースト)はコインと同じ「プレイヤーのタイルに入ったら」方式
  // (magnetは対象外。DESIGN §8・Step7)。
  function update(dt) {
    t += dt;
    if (typeof Player !== "undefined") {
      const p = Player.pos();
      if (coins.length) {
        const stats = getStats();
        const radius = Math.max(0, stats.magnet);
        for (const c of coins) {
          if (!c.alive) continue;
          // チェビシェフ距離(タイル単位の簡易円判定)。半径0なら同タイルのみ回収。
          const dist = Math.max(Math.abs(c.tx - p.tx), Math.abs(c.ty - p.ty));
          if (dist <= radius) {
            c.alive = false;
            collect(stats.coinMul, c.tx, c.ty);
          }
        }
        coins = coins.filter((c) => c.alive);
      }
      if (pickups.length) {
        for (const it of pickups) {
          if (!it.alive) continue;
          if (it.tx === p.tx && it.ty === p.ty) {
            it.alive = false;
            collectPickup(it.kind, it.tx, it.ty);
          }
        }
        pickups = pickups.filter((it) => it.alive);
      }
    }
    for (const fx of effects) fx.t += dt;
    effects = effects.filter((fx) => fx.t < fx.dur);
  }

  // ステージ終了時の持ち帰り処理。cleared=true(クリア)なら全額、
  // false(ゲームオーバー)なら CONFIG.ECONOMY.GAMEOVER_COIN_RATE(端数切り捨て)。
  // SAVE.data.coins へ加算・保存し、実際に持ち帰った枚数を返す。
  function settle(cleared) {
    const rate = cleared ? 1 : CONFIG.ECONOMY.GAMEOVER_COIN_RATE;
    const gained = Math.floor(stageCoins * rate);
    SAVE.data.coins = (SAVE.data.coins || 0) + gained;
    SAVE.save();
    return gained;
  }

  // --- 描画(cam はタイル単位の画面中央ワールド座標。player.draw と同座標系) ---
  function draw(g, cam) {
    for (const c of coins) {
      const bob = Math.sin(t * 3 + c.bob) * 0.08;
      const cx = (c.tx - cam.x) * TILE + VW / 2;
      const cy = (c.ty - cam.y) * TILE + VH / 2 + bob * TILE;
      g.fillStyle = "#ffd54a";
      g.beginPath();
      g.arc(cx, cy, TILE * 0.18, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = "rgba(255,255,255,0.6)";
      g.lineWidth = 2;
      g.beginPath();
      g.arc(cx, cy, TILE * 0.18, 0, Math.PI * 2);
      g.stroke();
    }
    // 拾得アイテム(ハート/シールド/ブースト)。絵文字アイコンで表示。
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = Math.round(TILE * 0.44) + "px sans-serif";
    for (const it of pickups) {
      const bob = Math.sin(t * 3 + it.bob) * 0.08;
      const cx = (it.tx - cam.x) * TILE + VW / 2;
      const cy = (it.ty - cam.y) * TILE + VH / 2 + bob * TILE;
      g.fillText(ICONS[it.kind] || "?", cx, cy);
    }
    g.textBaseline = "alphabetic";
    for (const fx of effects) {
      const p = fx.t / fx.dur;
      const cx = (fx.x - cam.x) * TILE + VW / 2;
      const cy = (fx.y - cam.y) * TILE + VH / 2 - p * TILE * 0.6;
      g.globalAlpha = 1 - p;
      if (fx.icon) {
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.font = Math.round(TILE * 0.34) + "px sans-serif";
        g.fillText(fx.icon, cx, cy);
        g.textBaseline = "alphabetic";
      } else {
        g.fillStyle = "#ffe9a0";
        g.beginPath();
        g.arc(cx, cy, TILE * (0.14 + p * 0.1), 0, Math.PI * 2);
        g.fill();
      }
      g.globalAlpha = 1;
    }
  }

  return {
    init, update, draw, settle, spawnCoin,
    get stageCoins() { return stageCoins; },
    _pickups() { return pickups; },
    _coins() { return coins; },
  };
})();
