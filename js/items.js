// items.js … 拾得アイテム・コイン
// DESIGN §8/§9。Step6ではコインのみ実装(ハート/シールド/ブーストはStep7で追加)。
// 座標系は player.js/enemies.js と同じ tx,ty(タイル=真実)。コインは浮遊演出のみ
// rAF の dt で行う(描画専用。拍・タイミング計算には使わない)。

const Items = (() => {
  const TILE = CONFIG.TILE;
  const VW = CONFIG.VIEW.W, VH = CONFIG.VIEW.H;

  let coins = [];       // { tx, ty, alive, bob }
  let stageCoins = 0;   // このステージで獲得した枚数(整数・持ち帰り計算の元)
  let coinFrac = 0;     // coinMul適用時の端数(1未満)。貯めて1以上になったら繰り上げる
  let effects = [];     // 回収エフェクト
  let t = 0;            // 浮遊演出用の経過秒

  function getStats() {
    return (typeof Equip !== "undefined") ? Equip.stats() : { coinMul: 1, magnet: 0 };
  }

  // レベルのスポーン候補(C)をコイン実体にする。
  function init(level) {
    coins = [];
    stageCoins = 0;
    coinFrac = 0;
    effects = [];
    t = 0;
    if (!level || !level.spawns) return;
    for (const s of level.spawns) {
      if (s.type !== "C") continue;
      coins.push({ tx: s.tx, ty: s.ty, alive: true, bob: Math.random() * Math.PI * 2 });
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

  // 毎フレーム更新:プレイヤーのタイル(+magnet半径以内)のコインを回収する。
  function update(dt) {
    t += dt;
    if (coins.length && typeof Player !== "undefined") {
      const p = Player.pos();
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
    for (const fx of effects) {
      const p = fx.t / fx.dur;
      const cx = (fx.x - cam.x) * TILE + VW / 2;
      const cy = (fx.y - cam.y) * TILE + VH / 2 - p * TILE * 0.6;
      g.globalAlpha = 1 - p;
      g.fillStyle = "#ffe9a0";
      g.beginPath();
      g.arc(cx, cy, TILE * (0.14 + p * 0.1), 0, Math.PI * 2);
      g.fill();
      g.globalAlpha = 1;
    }
  }

  return {
    init, update, draw, settle,
    get stageCoins() { return stageCoins; },
  };
})();
