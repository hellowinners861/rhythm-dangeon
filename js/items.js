// items.js … 拾得アイテム・コイン
// DESIGN §8/§9。Step6でコインを実装。Step7でハート/シールド/ブースト(拾得アイテム)を追加。
// 座標系は player.js/enemies.js と同じ tx,ty(タイル=真実)。コイン・アイテムの浮遊演出のみ
// rAF の dt で行う(描画専用。拍・タイミング計算には使わない)。

const Items = (() => {
  const TILE = CONFIG.TILE;
  const VW = CONFIG.VIEW.W, VH = CONFIG.VIEW.H;

  // 拾得アイテム種別のアイコン(絵文字。DESIGN §8)
  const ICONS = { heart: "💗", shield: "🛡", boost: "👟" };

  let coins = [];       // { tx, ty, ox, oy, value, alive, bob } … ox/oyは見た目オフセット(タイル単位)
  let pickups = [];     // { tx, ty, kind("heart"|"shield"|"boost"), alive, bob }
  let stageCoins = 0;   // このステージで獲得した枚数(整数・持ち帰り計算の元)
  let coinFrac = 0;     // coinMul適用時の端数(1未満)。貯めて1以上になったら繰り上げる
  let effects = [];     // 回収エフェクト
  let t = 0;            // 浮遊演出用の経過秒

  function getStats() {
    return (typeof Equip !== "undefined") ? Equip.stats() : { coinMul: 1, magnet: 0 };
  }

  // 額面(value)から見た目定義(COIN_TIERS)を引く。未定義額面は最小額面の見た目で代用。
  function tierFor(value) {
    const tiers = CONFIG.ITEMS.COIN_TIERS;
    for (const tr of tiers) if (tr.value === value) return tr;
    return tiers[tiers.length - 1];
  }

  // Cマーカーの額面抽選(COIN_SPAWN_WEIGHTSの重み付き・シード乱数randを使用)
  function pickCoinValue(rand) {
    const weights = CONFIG.ITEMS.COIN_SPAWN_WEIGHTS;
    const total = weights.reduce((s, w) => s + w.w, 0);
    let r = rand() * total;
    for (const w of weights) {
      if (r < w.w) return w.value;
      r -= w.w;
    }
    return weights[weights.length - 1].value;
  }

  // n を額面(50→10→3→1)へ貪欲法で分解する(例: 10→[10]、2→[1,1]、20→[10,10])。
  // 乱数を使わない純粋な計算なのでシード再現性に影響しない。
  function decomposeValue(n) {
    const tiers = CONFIG.ITEMS.COIN_TIERS.map((tr) => tr.value).slice().sort((a, b) => b - a);
    const out = [];
    let rem = n;
    for (const v of tiers) {
      while (rem >= v) {
        out.push(v);
        rem -= v;
      }
    }
    return out;
  }

  // 同タイル内で複数枚スポーンする際の見た目オフセット(±0.3タイル。円形に配置。乱数不使用)。
  function coinOffset(i, m) {
    if (m <= 1) return { ox: 0, oy: 0 };
    const ang = (Math.PI * 2 * i) / m;
    return { ox: Math.cos(ang) * 0.3, oy: Math.sin(ang) * 0.18 };
  }

  // レベルのスポーン候補(C=コイン/I=拾得アイテム)を実体にする。
  // rngFn: コイン額面・アイテム種別(ハート/シールド/ブースト)の抽選に使うシード乱数(省略時Math.random)。
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
        const value = pickCoinValue(rand);
        coins.push({ tx: s.tx, ty: s.ty, ox: 0, oy: 0, value, alive: true, bob: Math.random() * Math.PI * 2 });
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

  // 敵撃破時のコインドロップ(Enemies.damageAtから呼ばれる)。tx,tyへnを額面分解してまとめて生成する。
  function spawnCoin(tx, ty, n) {
    const vals = decomposeValue(n);
    const m = vals.length;
    vals.forEach((value, i) => {
      const off = coinOffset(i, m);
      coins.push({ tx, ty, ox: off.ox, oy: off.oy, value, alive: true, bob: Math.random() * Math.PI * 2 });
    });
  }

  // デバッグ用:指定額面のコインを直接1枚置く(検証用)
  function _debugSpawnCoin(tx, ty, value) {
    coins.push({ tx, ty, ox: 0, oy: 0, value, alive: true, bob: Math.random() * Math.PI * 2 });
  }

  // 回収(額面×coinMulを乗じて端数は累積・切り捨て)。stackIdxは同時複数回収時のポップ縦ずらし用。
  function collect(coinMul, tx, ty, value, stackIdx) {
    coinFrac += value * coinMul;
    const gained = Math.floor(coinFrac);
    if (gained > 0) {
      coinFrac -= gained;
      stageCoins += gained;
    }
    const tier = tierFor(value);
    effects.push({ x: tx, y: ty, t: 0, dur: 0.6, coin: true, value, color: tier.color, stackIdx: stackIdx || 0 });
    if (typeof SFX !== "undefined" && SFX.coin) SFX.coin(value);
  }

  // 攻撃でのコイン回収(Player.doAttack から攻撃範囲タイルを渡して呼ばれる)。
  // 指定タイル群にあるコインのみ回収する(ハート等の拾得アイテムは対象外)。
  // +nポップ・SE・coinMul適用は通常回収 collect() を再利用する。
  function collectCoinsAt(tiles) {
    if (!tiles || !tiles.length || !coins.length) return;
    const stats = getStats();
    let stackIdx = 0;
    for (const t of tiles) {
      for (const c of coins) {
        if (!c.alive) continue;
        if (c.tx === t.tx && c.ty === t.ty) {
          c.alive = false;
          collect(stats.coinMul, c.tx, c.ty, c.value, stackIdx++);
        }
      }
    }
    coins = coins.filter((c) => c.alive);
  }

  // 拾得アイテムの効果適用(ハート/シールド/ブースト)。DESIGN §8・Step7。
  // ハートはoverheal=trueで回復し、maxHpを超えて回復できる(rev3。そのステージ中のみ・次ステージ開始でリセット)。
  function collectPickup(kind, tx, ty) {
    if (typeof Player !== "undefined") {
      if (kind === "heart") Player.heal(CONFIG.ITEMS.HEAL_AMOUNT, true);
      else if (kind === "shield" && Player.addShield) Player.addShield(CONFIG.ITEMS.SHIELD_ADD);
      else if (kind === "boost" && Player.setBoost) Player.setBoost(CONFIG.ITEMS.BOOST_BEATS);
    }
    effects.push({ x: tx, y: ty, t: 0, dur: 0.4, icon: ICONS[kind] });
    if (typeof SFX !== "undefined" && SFX.pickup) SFX.pickup(); // コインとは別音色の取得音(Step9)
  }

  // 動的にpickupを1つ生成する(ボス召喚コウモリの撃破時ハートドロップ等。rev3)。
  // Iマーカー由来のpickupと同じ構造を再利用するため、init()の生成ロジックと処理・描画を共有できる。
  function spawnPickup(kind, tx, ty) {
    pickups.push({ tx, ty, kind, alive: true, bob: Math.random() * Math.PI * 2 });
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
        let stackIdx = 0; // 同フレーム内で複数回収した場合のポップ縦ずらし
        for (const c of coins) {
          if (!c.alive) continue;
          // チェビシェフ距離(タイル単位の簡易円判定)。半径0なら同タイルのみ回収。
          const dist = Math.max(Math.abs(c.tx - p.tx), Math.abs(c.ty - p.ty));
          if (dist <= radius) {
            c.alive = false;
            collect(stats.coinMul, c.tx, c.ty, c.value, stackIdx++);
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
  // mul=追加倍率(曲内クリア時の2倍等。省略時1。ゲームオーバー時は呼び出し側で渡さない=1のまま)。
  // SAVE.data.coins へ加算・保存し、実際に持ち帰った枚数を返す。
  function settle(cleared, mul) {
    const rate = cleared ? 1 : CONFIG.ECONOMY.GAMEOVER_COIN_RATE;
    const m = typeof mul === "number" ? mul : 1;
    const gained = Math.floor(stageCoins * rate * m);
    SAVE.data.coins = (SAVE.data.coins || 0) + gained;
    SAVE.save();
    return gained;
  }

  // --- 描画(cam はタイル単位の画面中央ワールド座標。player.draw と同座標系) ---
  function draw(g, cam) {
    for (const c of coins) {
      const tier = tierFor(c.value);
      const bob = Math.sin(t * 3 + c.bob) * 0.08;
      const cx = (c.tx + (c.ox || 0) - cam.x) * TILE + VW / 2;
      const cy = (c.ty + (c.oy || 0) - cam.y) * TILE + VH / 2 + bob * TILE;
      const r = TILE * tier.r;
      g.fillStyle = tier.color;
      g.beginPath();
      g.arc(cx, cy, r, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = tier.ring;
      g.lineWidth = 2;
      g.beginPath();
      g.arc(cx, cy, r, 0, Math.PI * 2);
      g.stroke();
      if (tier.label) {
        g.fillStyle = "#3a2a10";
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.font = "bold " + Math.round(r * 0.9) + "px sans-serif";
        g.fillText(tier.label, cx, cy);
        g.textBaseline = "alphabetic";
      }
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
      // stackIdx: 同時複数回収時にポップを縦にずらして重ならないようにする
      const cy = (fx.y - cam.y) * TILE + VH / 2 - p * TILE * 0.6 - (fx.stackIdx || 0) * TILE * 0.32;
      g.globalAlpha = 1 - p;
      if (fx.coin) {
        // コイン取得ポップ「+額面」(額面のコイン色でフェード)
        g.fillStyle = fx.color;
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.font = "bold " + Math.round(TILE * 0.32) + "px sans-serif";
        g.fillText("+" + fx.value, cx, cy);
        g.textBaseline = "alphabetic";
      } else if (fx.icon) {
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
    init, update, draw, settle, spawnCoin, collectCoinsAt, spawnPickup,
    get stageCoins() { return stageCoins; },
    _pickups() { return pickups; },
    _coins() { return coins; },
    _debugSpawnCoin,
  };
})();
