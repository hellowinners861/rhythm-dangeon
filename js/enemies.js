// enemies.js … ザコ敵(拍駆動AI・弾・爆弾)
// DESIGN §7。Step4で基本6種を実装。
//
// 【鉄則】敵の行動・テレグラフは全て拍基準(Conductor.currentBeat)で駆動する。
//   rAFの dt は描画トゥイーン・エフェクトの補間にのみ使う(拍計算に使わない)。
// 【座標の二重系】player.js と同じく tx,ty(タイル=真実)/ x,y(描画=トゥイーン)。
// 【被弾の伝達】プレイヤーへのダメージは Player.hurt() を直接呼び、成立した回数を返す。
//   ゲーム側は Enemies.kills / update() の戻り値を見て演出(ヒットストップ・揺れ)を出す。

const Enemies = (() => {
  const TILE = CONFIG.TILE;
  const VW = CONFIG.VIEW.W, VH = CONFIG.VIEW.H;

  let level = null;
  let list = [];      // 敵
  let bullets = [];   // ガンナー敵の弾
  let bombs = [];     // ボマーの爆弾
  let effects = [];   // 消滅・爆発などの演出(演出乱数は Math.random 可)
  let lastBeat = null; // 最後に処理した整数拍
  let kills = 0;       // 撃破総数(ゲーム側がスコア・ヒットストップ検出に使う)
  let feverActive = false; // Game側から毎フレーム渡されるフィーバー状態(コインドロップ2倍用)

  // 抽選対象は基本6種のみ(色違いはbaseを持つため除外)。色違いは基本種を選んだ後、
  // variantRate の確率で同baseの色違いに置換する方式(DESIGN §7/§10・Step7)。
  const ALL_KINDS = Object.keys(CONFIG.ENEMIES);
  const KINDS = ALL_KINDS.filter((k) => !CONFIG.ENEMIES[k].base);
  const VARIANT_OF = {}; // 基本種名 → 色違い種名
  for (const k of ALL_KINDS) {
    const def = CONFIG.ENEMIES[k];
    if (def.base) VARIANT_OF[def.base] = k;
  }
  const MOVE_BEATS = 0.32;   // 移動トゥイーンの所要拍(見た目)

  function beatsToSec(beats) {
    const bpm = (Conductor && Conductor.bpm) ? Conductor.bpm : CONFIG.METRONOME.BPM;
    return (60 / bpm) * beats;
  }
  function curBeat() {
    return Conductor.running ? Conductor.currentBeat() : 0;
  }
  function solid(cx, cy) { return LevelGen.solidAt(level, cx, cy); }
  function easeOut(p) { const q = 1 - p; return 1 - q * q * q; }

  // --- 初期化:E スポーンをシード乱数で6種(+色違い)に実体化 ---
  // variantRate: 基本種を選んだ後、同baseの色違いに置換する確率(章テーマ由来。省略時0)
  function init(lv, rngFn, variantRate) {
    level = lv;
    list = []; bullets = []; bombs = []; effects = [];
    lastBeat = null; kills = 0;
    const rand = rngFn || Math.random;
    const vRate = variantRate || 0;
    if (!lv || !lv.spawns) return;
    for (const s of lv.spawns) {
      if (s.type !== "E") continue;
      let ki = Math.floor(rand() * KINDS.length);
      if (ki >= KINDS.length) ki = KINDS.length - 1;
      let kind = KINDS[ki];
      if (rand() < vRate && VARIANT_OF[kind]) kind = VARIANT_OF[kind]; // 色違いに差し替え
      const def = CONFIG.ENEMIES[kind];
      const interval = def.interval;
      const phase = interval > 0 ? Math.floor(rand() * interval) % interval : 0;
      const dir = rand() < 0.5 ? -1 : 1;
      list.push({
        kind, def, ai: def.ai,
        tx: s.tx, ty: s.ty, x: s.tx, y: s.ty,
        hp: def.hp, dir,
        interval, phase,
        fly: !!def.fly,
        transparent: false,       // ゴースト用
        pendingMelee: null,       // ナイトの攻撃予約 {beat,dir}
        tw: { fromX: s.tx, fromY: s.ty, toX: s.tx, toY: s.ty, t: 0, dur: 0.001, active: false },
        alive: true,
      });
    }
  }

  // 敵を目標タイルへ動かす(見た目はトゥイーン)。
  function moveTo(e, ntx, nty) {
    e.tx = ntx; e.ty = nty;
    e.tw.fromX = e.x; e.tw.fromY = e.y;
    e.tw.toX = ntx; e.tw.toY = nty;
    e.tw.t = 0; e.tw.dur = Math.max(0.001, beatsToSec(MOVE_BEATS)); e.tw.active = true;
  }

  // この整数拍に敵が行動するか
  function actsOn(e, b) {
    return e.interval > 0 && (((b % e.interval) + e.interval) % e.interval) === e.phase;
  }

  // プレイヤーのタイル座標
  function playerTile() {
    const p = Player.pos();
    return { tx: p.tx, ty: p.ty };
  }

  // プレイヤーへダメージ(無敵中は Player.hurt が false を返す)。成立で1を返す。
  // opts.projectile … 弾によるダメージなら true(忍び装束のprojDefMulを適用させる)。
  function hurtPlayer(dmg, sourceTx, opts) {
    const p = Player.pos();
    let sourceDir = 0;
    if (sourceTx > p.tx) sourceDir = 1;
    else if (sourceTx < p.tx) sourceDir = -1;
    return Player.hurt(dmg, sourceDir, opts) ? 1 : 0;
  }

  // --- 1整数拍ぶんの行動(拍跨ぎごとに順に呼ばれる) ---
  function stepBeat(b) {
    let hits = 0;
    const p = playerTile();

    // 1) ナイトの攻撃予約(前拍に予約されたもの)を実行
    for (const e of list) {
      if (!e.alive || !e.pendingMelee) continue;
      if (e.pendingMelee.beat === b) {
        const ax = e.tx + e.pendingMelee.dir, ay = e.ty;
        if (p.tx === ax && p.ty === ay) hits += hurtPlayer(e.def.dmg, e.tx);
        e.pendingMelee = null;
      }
    }

    // 2) 敵ごとの行動
    for (const e of list) {
      if (!e.alive) continue;
      switch (e.ai) {
        case "patrol": stepPatrol(e, b); break;
        case "chase":  stepChase(e, b, p); break;
        case "knight": stepKnight(e, b, p); break;
        case "shooter": stepShooter(e, b, p); break;
        case "ghost":  stepGhost(e, b, p); break;
        case "bomber": stepBomber(e, b, p); break;
      }
    }

    // 3) 弾の前進・衝突
    hits += stepBullets(b);
    // 4) 爆弾の点火・爆発
    hits += stepBombs(b);

    // 5) 接触判定(敵が動いた後・実体のみ)。プレイヤーと同じタイルの敵はダメージ。
    //    とげの鎧(thorns): 敵側からの体当たり接触(ナイトの予約攻撃(1)の処理は除く)にも反撃する。
    const p2 = playerTile();
    const eqStats = (typeof Equip !== "undefined") ? Equip.stats() : null;
    for (const e of list) {
      if (!e.alive || e.transparent) continue;
      if (e.tx === p2.tx && e.ty === p2.ty) {
        const hit = hurtPlayer(e.def.dmg, e.tx);
        hits += hit;
        if (hit > 0 && eqStats && eqStats.thorns > 0) damageAt([{ tx: e.tx, ty: e.ty }], eqStats.thorns);
      }
    }
    return hits;
  }

  // patrol(スライム):向いた方向へ1タイル。壁・崖なら反転(そのターンは止まる)。
  function stepPatrol(e, b) {
    if (!actsOn(e, b)) return;
    const nx = e.tx + e.dir;
    if (solid(nx, e.ty) || !solid(nx, e.ty + 1)) { e.dir = -e.dir; return; }
    moveTo(e, nx, e.ty);
  }

  // chase(バット):毎拍プレイヤーへ1タイル接近(横優先・飛行)。視界外なら待機。
  // flee(ゴールドバット): プレイヤーから離れる方向へ動く逃走AI(距離・視界判定は同じ)。
  function stepChase(e, b, p) {
    if (!actsOn(e, b)) return;
    let dx = p.tx - e.tx, dy = p.ty - e.ty;
    const vision = e.def.vision || 8;
    if (Math.abs(dx) + Math.abs(dy) > vision) return;
    if (e.def.flee) { dx = -dx; dy = -dy; }
    if (dx !== 0) {
      const d = Math.sign(dx);
      if (!solid(e.tx + d, e.ty)) { e.dir = d; moveTo(e, e.tx + d, e.ty); return; }
    }
    if (dy !== 0) {
      const d = Math.sign(dy);
      if (!solid(e.tx, e.ty + d)) moveTo(e, e.tx, e.ty + d);
    }
  }

  // knight(ナイト):行動拍にプレイヤーへ横接近(崖では止まる)。隣接なら次拍を攻撃予約。
  // 静寂のスリッパ(stealth): 隣接しても一切反応しない(待機。移動も攻撃予約もしない)。
  function stepKnight(e, b, p) {
    if (e.pendingMelee) return; // 攻撃モーション中は動かない
    if (!actsOn(e, b)) return;
    const dx = p.tx - e.tx;
    const stealthy = typeof Equip !== "undefined" && Equip.stats().stealth;
    if (Math.abs(dx) === 1 && p.ty === e.ty) {
      if (stealthy) return; // 静寂のスリッパ:隣接しても反応しない
      // 隣接 → 向きを合わせ、次拍に攻撃(1拍前からテレグラフ)
      e.dir = Math.sign(dx);
      e.pendingMelee = { beat: b + 1, dir: e.dir };
      return;
    }
    if (dx !== 0) {
      const d = Math.sign(dx);
      e.dir = d;
      if (!solid(e.tx + d, e.ty) && solid(e.tx + d, e.ty + 1)) moveTo(e, e.tx + d, e.ty);
    }
  }

  // shooter(ガンナー敵):行動拍にプレイヤー方向へ弾。テレグラフは描画側で表現。
  function stepShooter(e, b, p) {
    if (!actsOn(e, b)) return;
    let d = Math.sign(p.tx - e.tx);
    if (d === 0) d = e.dir;
    e.dir = d;
    const spd = e.def.bulletSpeed || 1;
    bullets.push({
      tx: e.tx + d, ty: e.ty, x: e.tx + d, y: e.ty,
      dx: d, speed: spd,
      tw: { fromX: e.tx + d, toX: e.tx + d, t: 0, dur: 0.001, active: false },
      alive: true,
    });
  }

  // ghost(ゴースト):行動拍に実体⇔透明トグル。実体中は毎拍プレイヤーへ1タイル接近(飛行)。
  function stepGhost(e, b, p) {
    if (actsOn(e, b)) e.transparent = !e.transparent;
    if (e.transparent) return; // 透明中は移動も接触もしない
    const dx = p.tx - e.tx, dy = p.ty - e.ty;
    const vision = e.def.vision || 12;
    if (Math.abs(dx) + Math.abs(dy) > vision) return;
    if (dx !== 0) {
      const d = Math.sign(dx);
      if (!solid(e.tx + d, e.ty)) { e.dir = d; moveTo(e, e.tx + d, e.ty); return; }
    }
    if (dy !== 0) {
      const d = Math.sign(dy);
      if (!solid(e.tx, e.ty + d)) moveTo(e, e.tx, e.ty + d);
    }
  }

  // bomber(ボマー):行動拍に自分のタイルへ爆弾設置し1タイル後退(壁なら前進)。
  // bombMax(デスボマー=2): 自分が設置した爆弾がbombMax個未満のときだけ新規設置する。
  function stepBomber(e, b, p) {
    if (!actsOn(e, b)) return;
    const maxBombs = e.def.bombMax || 1;
    const owned = bombs.filter((bm) => bm.owner === e && bm.alive).length;
    if (owned >= maxBombs) return; // 上限に達していれば設置しない(移動もしない)
    bombs.push({
      tx: e.tx, ty: e.ty, fuse: e.def.bombFuse || 2,
      shape: e.def.bombShape || "cross", owner: e, alive: true,
    });
    // プレイヤーと逆方向へ後退
    let back = -Math.sign(p.tx - e.tx);
    if (back === 0) back = -e.dir;
    const canMove = (d) => d !== 0 && !solid(e.tx + d, e.ty) && solid(e.tx + d, e.ty + 1);
    if (canMove(back)) { e.dir = back; moveTo(e, e.tx + back, e.ty); }
    else if (canMove(-back)) { e.dir = -back; moveTo(e, e.tx - back, e.ty); }
  }

  // 弾を前進させ、壁で消滅・プレイヤー命中でダメージ。
  function stepBullets(b) {
    let hits = 0;
    const p = playerTile();
    for (const bl of bullets) {
      if (!bl.alive) continue;
      let nx = bl.tx;
      for (let s = 0; s < bl.speed; s++) {
        const cand = nx + bl.dx;
        if (solid(cand, bl.ty)) { bl.alive = false; break; }
        nx = cand;
        if (nx === p.tx && bl.ty === p.ty) {
          hits += hurtPlayer(1, nx - bl.dx, { projectile: true }); // 弾ダメージ(忍び装束のprojDefMul対象)
          bl.alive = false; break;
        }
      }
      if (bl.alive) {
        bl.tw.fromX = bl.x; bl.tw.toX = nx; bl.tw.t = 0;
        bl.tw.dur = Math.max(0.001, beatsToSec(0.95)); bl.tw.active = true;
        bl.tx = nx;
      }
    }
    bullets = bullets.filter((x) => x.alive);
    return hits;
  }

  // 爆弾の爆発範囲(cross=十字1タイル / square=3×3。デスボマーはsquare)。
  function bombCells(bm) {
    if (bm.shape === "square") {
      const cells = [];
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) cells.push({ tx: bm.tx + dx, ty: bm.ty + dy });
      }
      return cells;
    }
    return [
      { tx: bm.tx, ty: bm.ty },
      { tx: bm.tx + 1, ty: bm.ty }, { tx: bm.tx - 1, ty: bm.ty },
      { tx: bm.tx, ty: bm.ty + 1 }, { tx: bm.tx, ty: bm.ty - 1 },
    ];
  }

  // 爆弾の導火・爆発。プレイヤーにも敵にもダメージ。
  function stepBombs(b) {
    let hits = 0;
    const p = playerTile();
    for (const bm of bombs) {
      if (!bm.alive) continue;
      bm.fuse--;
      if (bm.fuse > 0) continue;
      const cells = bombCells(bm);
      // 敵へダメージ
      damageAt(cells, 1);
      // プレイヤーへダメージ
      for (const c of cells) {
        if (c.tx === p.tx && c.ty === p.ty) { hits += hurtPlayer(1, bm.tx); break; }
      }
      // 爆発エフェクト
      for (const c of cells) {
        effects.push({ type: "boom", x: c.tx, y: c.ty, t: 0, dur: 0.3 });
      }
      bm.alive = false;
    }
    bombs = bombs.filter((x) => x.alive);
    return hits;
  }

  // --- 外部API:攻撃ダメージ ---
  // tiles=[{tx,ty}] の実体敵へ atk ダメージ。透明ゴーストは無効。
  // 戻り値:当てた敵情報 [{kind,tx,ty,killed}]。
  function damageAt(tiles, atk, opts) {
    const out = [];
    for (const t of tiles) {
      for (const e of list) {
        if (!e.alive || e.transparent) continue;
        if (e.tx !== t.tx || e.ty !== t.ty) continue;
        e.hp -= atk;
        const killed = e.hp <= 0;
        if (killed) {
          e.alive = false;
          kills++;
          SFX.enemyDie();
          effects.push({ type: "die", x: e.tx, y: e.ty, t: 0, dur: 0.28, color: e.def.color });
          // 小さな白い破片(3〜5個。演出のみ・Math.random可・Step9)
          const shardN = 3 + Math.floor(Math.random() * 3);
          for (let i = 0; i < shardN; i++) {
            effects.push({
              type: "shard", x: e.tx, y: e.ty, t: 0, dur: 0.3 + Math.random() * 0.14,
              ang: Math.random() * Math.PI * 2, dist: 0.3 + Math.random() * 0.35,
            });
          }
          // コインドロップ(フィーバー中は2倍。DESIGN §3/§7・Step7)
          const dropN = (e.def.coinDrop || 0) * (feverActive ? 2 : 1);
          if (dropN > 0 && typeof Items !== "undefined" && Items.spawnCoin) Items.spawnCoin(e.tx, e.ty, dropN);
        }
        out.push({ kind: e.kind, tx: e.tx, ty: e.ty, killed });
      }
    }
    if (out.length) list = list.filter((e) => e.alive);
    return out;
  }

  // Game側から毎フレーム渡されるフィーバー状態(コインドロップ2倍の判定に使う)。
  function setFever(v) { feverActive = !!v; }

  // 指定タイルの実体敵(透明ゴーストは対象外)。プレイヤー移動時の接触照会用。
  function enemyAt(tx, ty) {
    for (const e of list) {
      if (!e.alive || e.transparent) continue;
      if (e.tx === tx && e.ty === ty) return e;
    }
    return null;
  }

  // --- 毎フレーム更新(拍跨ぎ処理 + トゥイーン/エフェクトの補間) ---
  // frozen=true(休符区間)のときは拍の行動処理を止める。ただし lastBeat は現在拍まで
  //   進めておき、休符明けに溜まった拍を一括処理してしまわないようにする。
  function update(dt, frozen) {
    // 拍跨ぎ処理(拍計算のみ Conductor)
    let hits = 0;
    if (Conductor.running) {
      const curInt = Math.floor(curBeat());
      if (lastBeat === null) {
        lastBeat = curInt;
      } else if (curInt > lastBeat) {
        if (frozen) {
          lastBeat = curInt; // 休符中は行動せず拍だけ進める
        } else {
          let from = lastBeat + 1;
          if (curInt - from > 8) from = curInt - 8; // タブ復帰等:上限8拍だけ処理
          for (let b = from; b <= curInt; b++) hits += stepBeat(b);
          lastBeat = curInt;
        }
      }
    }

    // トゥイーン/エフェクトは dt(rAF)で補間
    for (const e of list) advanceTween(e.tw, dt, (X, Y) => { e.x = X; e.y = Y; });
    for (const bl of bullets) {
      if (bl.tw.active) {
        bl.tw.t += dt;
        const pr = Math.min(1, bl.tw.t / bl.tw.dur);
        bl.x = bl.tw.fromX + (bl.tw.toX - bl.tw.fromX) * pr; // 弾は等速で
        if (pr >= 1) bl.tw.active = false;
      }
    }
    for (const fx of effects) fx.t += dt;
    effects = effects.filter((fx) => fx.t < fx.dur);
    return hits;
  }

  function advanceTween(tw, dt, apply) {
    if (!tw.active) return;
    tw.t += dt;
    const p = Math.min(1, tw.t / tw.dur);
    const e = easeOut(p);
    apply(tw.fromX + (tw.toX - tw.fromX) * e, tw.fromY + (tw.toY - tw.fromY) * e);
    if (p >= 1) tw.active = false;
  }

  // --- 描画(cam はタイル単位の画面中央ワールド座標。player.draw と同座標系) ---
  let camRef = { x: 0, y: 0 };
  function sx(wx) { return (wx - camRef.x) * TILE + VW / 2; }
  function sy(wy) { return (wy - camRef.y) * TILE + VH / 2; }

  function draw(g, cam) {
    camRef = cam;
    const cur = curBeat();

    // 爆弾(点滅)
    for (const bm of bombs) drawBomb(g, bm, cur);
    // 弾
    for (const bl of bullets) drawBullet(g, bl);
    // 敵
    for (const e of list) drawEnemy(g, e, cur);
    // エフェクト(消滅・爆発)
    for (const fx of effects) drawEffect(g, fx);
  }

  // 次にこの敵が行動する整数拍
  function nextActBeat(e, cur) {
    if (e.interval <= 0) return Infinity;
    let n = Math.ceil(cur - 1e-6);
    for (let i = 0; i < e.interval + 1; i++) {
      if ((((n % e.interval) + e.interval) % e.interval) === e.phase) return n;
      n++;
    }
    return n;
  }

  // スプライトキーの例外表(kind→Spritesキー)。省略時は "enemy_" + kind とみなす。
  const ENEMY_SPRITE_KEY = { redslime: "enemy_slime_red" };

  function drawEnemy(g, e, cur) {
    const cx = sx(e.x), cy = sy(e.y);
    const r = TILE * 0.4;

    // テレグラフ:行動拍の1拍前から発光・膨張。攻撃予約中は赤く強く光る。
    let glow = 0, danger = false;
    if (e.pendingMelee) {
      const t = e.pendingMelee.beat - cur; // 1→0で攻撃
      glow = Math.max(0, Math.min(1, 1 - t));
      danger = true;
    } else if (!e.transparent) {
      const nb = nextActBeat(e, cur);
      glow = Math.max(0, Math.min(1, 1 - (nb - cur)));
      danger = (e.ai === "shooter"); // 射撃は攻撃なので赤
    }
    const scale = 1 + glow * 0.18;
    const rr = r * scale;

    let alpha = 1;
    if (e.transparent) alpha = 0.28;
    g.save();
    g.globalAlpha = alpha;

    // 影(飛行以外)
    if (!e.fly) {
      g.globalAlpha = alpha * 0.32;
      g.fillStyle = "#000";
      g.beginPath();
      g.ellipse(cx, sy(e.ty) + r * 0.98, r * 0.85, r * 0.26, 0, 0, Math.PI * 2);
      g.fill();
      g.globalAlpha = alpha;
    }

    // テレグラフのハロー
    if (glow > 0.02) {
      g.globalAlpha = alpha * glow * 0.55;
      g.fillStyle = danger ? "#ff5a6a" : "#fff3a0";
      g.beginPath();
      g.arc(cx, cy, rr * 1.5, 0, Math.PI * 2);
      g.fill();
      g.globalAlpha = alpha;
    }

    // スプライトがあれば画像描画、無ければ従来の図形+目にフォールバック。
    const sprKey = ENEMY_SPRITE_KEY[e.kind] || ("enemy_" + e.kind);
    const sprEntry = (typeof Sprites !== "undefined") ? Sprites.getEntry(sprKey) : null;

    if (sprEntry) {
      // --- スプライト描画(不透明box基準。テレグラフと同じ拡大率scaleを適用) ---
      const box = sprEntry.box;
      const boxH = box.maxy - box.miny + 1;
      const drawH = CONFIG.SPRITE.ENEMY_TILES * TILE * scale;
      const spScale = drawH / boxH;
      const srcCx = (box.minx + box.maxx + 1) / 2;
      const srcFootY = box.maxy + 1;               // box下端(接地用)
      const srcMidY = (box.miny + box.maxy + 1) / 2; // box中心(浮遊用)
      // 地上敵:box下端を接地ライン(タイル下端)に合わせる / 飛行敵:box中心をタイル中心に合わせる
      const anchorY = e.fly ? cy : (cy + TILE * 0.5);
      const srcAnchorY = e.fly ? srcMidY : srcFootY;

      g.imageSmoothingEnabled = true;
      g.translate(cx, anchorY);
      if (e.dir < 0) g.scale(-1, 1); // 左向きは水平反転(元画像は正面〜右向き)
      g.scale(spScale, spScale);
      g.drawImage(sprEntry.canvas, -srcCx, -srcAnchorY);
    } else {
      // --- フォールバック:従来の図形+目(スプライト未ロード/未着の種) ---
      g.fillStyle = e.def.color;
      switch (e.def.base || e.kind) { // 色違いは基本種の形を流用(色はe.def.colorで差し替え済み)
        case "slime": drawSlime(g, cx, cy, rr); break;
        case "bat":   drawBat(g, cx, cy, rr, e.dir); break;
        case "knight": drawKnight(g, cx, cy, rr, e.dir); break;
        case "gunner": drawGunner(g, cx, cy, rr, e.dir); break;
        case "ghost": drawGhost(g, cx, cy, rr); break;
        case "bomber": drawBomber(g, cx, cy, rr); break;
        default: g.beginPath(); g.arc(cx, cy, rr, 0, Math.PI * 2); g.fill();
      }
      drawEyes(g, cx, cy - rr * 0.1, rr, e.dir);
    }
    g.restore();
  }

  function drawEyes(g, cx, cy, r, dir) {
    g.fillStyle = "#fff";
    g.beginPath();
    g.arc(cx - r * 0.25, cy, r * 0.2, 0, Math.PI * 2);
    g.arc(cx + r * 0.25, cy, r * 0.2, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#12141c";
    g.beginPath();
    g.arc(cx - r * 0.25 + dir * r * 0.06, cy, r * 0.09, 0, Math.PI * 2);
    g.arc(cx + r * 0.25 + dir * r * 0.06, cy, r * 0.09, 0, Math.PI * 2);
    g.fill();
  }

  function drawSlime(g, cx, cy, r) {
    // 半円(下は平ら)
    g.beginPath();
    g.arc(cx, cy + r * 0.35, r, Math.PI, 0);
    g.lineTo(cx + r, cy + r * 0.55);
    g.lineTo(cx - r, cy + r * 0.55);
    g.closePath();
    g.fill();
  }
  function drawBat(g, cx, cy, r, dir) {
    // 三角翼+丸胴
    g.beginPath();
    g.moveTo(cx, cy);
    g.lineTo(cx - r * 1.3, cy - r * 0.5);
    g.lineTo(cx - r * 0.4, cy + r * 0.1);
    g.closePath();
    g.moveTo(cx, cy);
    g.lineTo(cx + r * 1.3, cy - r * 0.5);
    g.lineTo(cx + r * 0.4, cy + r * 0.1);
    g.closePath();
    g.fill();
    g.beginPath(); g.arc(cx, cy, r * 0.6, 0, Math.PI * 2); g.fill();
  }
  function drawKnight(g, cx, cy, r, dir) {
    // 四角胴+剣線
    g.fillRect(cx - r * 0.7, cy - r * 0.7, r * 1.4, r * 1.4);
    g.strokeStyle = "#eef1ff";
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(cx + dir * r * 0.7, cy);
    g.lineTo(cx + dir * r * 1.5, cy - r * 0.2);
    g.stroke();
  }
  function drawGunner(g, cx, cy, r, dir) {
    g.beginPath(); g.arc(cx, cy, r * 0.85, 0, Math.PI * 2); g.fill();
    // 砲身
    g.fillRect(cx + (dir > 0 ? r * 0.4 : -r * 1.2), cy - r * 0.18, r * 0.8, r * 0.36);
  }
  function drawGhost(g, cx, cy, r) {
    g.beginPath();
    g.arc(cx, cy - r * 0.1, r, Math.PI, 0);
    // 波裾
    const n = 4;
    for (let i = 0; i <= n; i++) {
      const px = cx + r - (2 * r) * (i / n);
      const py = cy + r * 0.55 + (i % 2 === 0 ? 0 : -r * 0.3);
      g.lineTo(px, py);
    }
    g.closePath();
    g.fill();
  }
  function drawBomber(g, cx, cy, r) {
    g.beginPath(); g.arc(cx, cy, r * 0.85, 0, Math.PI * 2); g.fill();
    // 導火線
    g.strokeStyle = "#ffe08a";
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(cx, cy - r * 0.8);
    g.lineTo(cx + r * 0.3, cy - r * 1.2);
    g.stroke();
  }

  function drawBullet(g, bl) {
    const cx = sx(bl.x), cy = sy(bl.y);
    g.fillStyle = "#ffd54a";
    g.beginPath();
    g.arc(cx, cy, TILE * 0.16, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "rgba(255,213,74,0.5)";
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(cx, cy);
    g.lineTo(cx - bl.dx * TILE * 0.4, cy);
    g.stroke();
  }

  function drawBomb(g, bm, cur) {
    const cx = sx(bm.tx), cy = sy(bm.ty);
    // 点滅:残り1拍(fuse<=1)で速く点滅
    const blink = bm.fuse <= 1 ? (0.5 + 0.5 * Math.sin(cur * Math.PI * 4)) : 0.4;
    g.fillStyle = "rgba(40,40,50,0.85)";
    g.beginPath();
    g.arc(cx, cy, TILE * 0.3, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = `rgba(255,90,80,${0.4 + 0.6 * blink})`;
    g.beginPath();
    g.arc(cx, cy - TILE * 0.28, TILE * 0.08, 0, Math.PI * 2);
    g.fill();
  }

  function drawEffect(g, fx) {
    const p = fx.t / fx.dur;
    const cx = sx(fx.x), cy = sy(fx.y);
    if (fx.type === "die") {
      g.globalAlpha = 1 - p;
      g.fillStyle = fx.color || "#fff";
      g.beginPath();
      g.arc(cx, cy, TILE * (0.2 + p * 0.4), 0, Math.PI * 2);
      g.fill();
      g.globalAlpha = 1;
    } else if (fx.type === "boom") {
      g.globalAlpha = 1 - p;
      g.fillStyle = "#ffcf6b";
      g.beginPath();
      g.arc(cx, cy, TILE * (0.3 + p * 0.3), 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#ff6b4a";
      g.beginPath();
      g.arc(cx, cy, TILE * (0.15 + p * 0.2), 0, Math.PI * 2);
      g.fill();
      g.globalAlpha = 1;
    } else if (fx.type === "shard") {
      // 撃破時の小さな白い破片(外側へ飛び散りながら縮小・フェード)
      const dx = Math.cos(fx.ang) * fx.dist * p;
      const dy = Math.sin(fx.ang) * fx.dist * p;
      g.globalAlpha = 1 - p;
      g.fillStyle = "#fff";
      const s = TILE * 0.1 * (1 - p * 0.5);
      g.fillRect(sx(fx.x + dx) - s / 2, sy(fx.y + dy) - s / 2, s, s);
      g.globalAlpha = 1;
    }
  }

  // デバッグ用:任意種の敵を任意タイルへ配置(検証で使用)。
  function _debugSpawn(kind, tx, ty, phase) {
    const def = CONFIG.ENEMIES[kind];
    if (!def) return null;
    const e = {
      kind, def, ai: def.ai,
      tx, ty, x: tx, y: ty,
      hp: def.hp, dir: -1,
      interval: def.interval, phase: (phase || 0) % def.interval,
      fly: !!def.fly, transparent: false, pendingMelee: null,
      tw: { fromX: tx, fromY: ty, toX: tx, toY: ty, t: 0, dur: 0.001, active: false },
      alive: true,
    };
    list.push(e);
    return e;
  }

  return {
    init, update, draw, damageAt, enemyAt, setFever,
    spawn: _debugSpawn, // ボスの召喚など動的スポーンの正式API(kind, tx, ty[, phase])
    get count() { return list.length; },
    get bulletCount() { return bullets.length; },
    get bombCount() { return bombs.length; },
    get kills() { return kills; },
    _debugSpawn,
    _list() { return list; },
    _bullets() { return bullets; },
    _bombs() { return bombs; },
  };
})();
