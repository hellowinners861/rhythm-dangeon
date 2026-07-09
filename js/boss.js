// boss.js … ボス3種(パターンデータ+フェーズ管理)
// DESIGN §7/§10・Step8。章ごとに固定のボスをアリーナで戦う。
//
// 【鉄則】ボスの行動・テレグラフは全て拍基準(Conductor.currentBeat)で駆動する。
//   rAFの dt は描画トゥイーン・エフェクトの補間にのみ使う(拍計算に使わない)。
// 【座標系】player.js/enemies.js と同じ tile 単位。boss.tx,ty は「占有矩形の左上タイル(真実)」、
//   boss.x,y はトゥイーンする描画用アンカー。占有は [tx..tx+w-1]×[ty..ty+h-1]。
// 【攻撃は必ず1拍以上のテレグラフを挟む】(発光・予兆)。HP残量でフェーズ切替(50%以下でphase2)。

const Boss = (() => {
  const TILE = CONFIG.TILE;
  const VW = CONFIG.VIEW.W, VH = CONFIG.VIEW.H;
  const INTRO_BEATS = 2;   // 出現演出(この間は行動しない)
  const DYING_BEATS = 4;   // 撃破演出(点滅→爆散)
  const VULN_MUL = 1.5;    // 隙(サイレンサー着地)中の被ダメ倍率

  // 章index(0..2) → ボス種別。数値・サイズ・パターンの詳細はここに集約(DESIGN §10)。
  const KIND_BY_CHAPTER = ["silencer", "beatcrusher", "mutos"];
  const DATA = {
    silencer:    { color: "#6b4a8f", color2: "#a05ad0", w: 2, h: 2, fly: true,  cycle: 16, airRow: 2 },
    beatcrusher: { color: "#8a8f9c", color2: "#c85a5a", w: 3, h: 3, fly: false, cycle: 16 },
    mutos:       { color: "#7a2fae", color2: "#d03a8a", w: 2, h: 3, fly: true,  cycle: 20, airRow: 2 },
  };

  let level = null;
  let arena = null;        // level.arena(startX/playLeft/playRight/standRow/…)
  let boss = null;         // 現在のボス(なければ null)
  let bullets = [];        // ボスの弾(衝撃波・音符弾)
  let effects = [];        // 演出(爆散・テレポート等。演出乱数は Math.random 可)
  let lastBeat = null;     // 最後に処理した整数拍
  let pendingShake = 0;    // 画面揺れ要求(game が毎フレーム回収して加算)

  function beatsToSec(beats) {
    const bpm = (Conductor && Conductor.bpm) ? Conductor.bpm : CONFIG.METRONOME.BPM;
    return (60 / bpm) * beats;
  }
  function curBeat() { return Conductor.running ? Conductor.currentBeat() : 0; }
  function solid(cx, cy) { return LevelGen.solidAt(level, cx, cy); }
  function easeOut(p) { const q = 1 - p; return 1 - q * q * q; }

  // --- 準備 ---
  function reset() {
    boss = null; bullets = []; effects = []; lastBeat = null; pendingShake = 0;
    level = null; arena = null;
  }

  // ボス出現。chapterIndex(0..2)でボス種別を決め、アリーナ中央付近に配置する。
  function spawn(chapterIndex, lv) {
    level = lv;
    arena = lv.arena;
    bullets = []; effects = []; lastBeat = null; pendingShake = 0;
    const kind = KIND_BY_CHAPTER[chapterIndex] || "silencer";
    const d = DATA[kind];
    const def = CONFIG.BOSSES[kind];
    const centerX = arena.startX + Math.floor(CONFIG.STAGE.ARENA_W / 2);
    let tx = clampX(centerX - Math.floor(d.w / 2), d.w);
    let ty = d.fly ? d.airRow : (arena.standRow - (d.h - 1));
    const spawnBeat = Math.floor(curBeat());
    boss = {
      kind, def, d, name: def.name,
      w: d.w, h: d.h, fly: d.fly,
      tx, ty, x: tx, y: ty,
      dir: -1, dashDir: 1,
      hp: def.hp, maxHp: def.hp, phase: 1,
      state: "intro",                 // intro → fight → dying → gone
      spawnBeat, fightStartBeat: spawnBeat + INTRO_BEATS, deathBeat: 0,
      telegraph: null,                // 予兆種別(描画用)。null で解除
      vulnUntil: -1e9,                // この拍まで被ダメ1.5倍(着地隙)
      forcedRest: null,               // 強制休符 {start,len}(ミュートス)
      lift: 0, liftTarget: 0,         // ジャンププレスの描画リフト(タイル・見た目のみ)
      tw: { fromX: tx, fromY: ty, toX: tx, toY: ty, t: 0, dur: 0.001, active: false },
    };
  }

  // --- 座標・移動ヘルパ ---
  function clampX(nx, w) {
    const lo = arena.playLeft;
    const hi = arena.playRight - (w - 1);
    return Math.max(lo, Math.min(hi, nx));
  }
  function bossCenterCol() { return boss.tx + (boss.w - 1) / 2; }

  // アンカーを目標タイルへ移動(見た目はトゥイーン)。teleport=true で瞬間移動(演出のみ)。
  function moveAnchor(nx, ny, teleport) {
    boss.tx = clampX(nx, boss.w);
    boss.ty = ny;
    if (teleport) {
      boss.x = boss.tx; boss.y = boss.ty; boss.tw.active = false;
    } else {
      boss.tw.fromX = boss.x; boss.tw.fromY = boss.y;
      boss.tw.toX = boss.tx; boss.tw.toY = boss.ty;
      boss.tw.t = 0; boss.tw.dur = Math.max(0.001, beatsToSec(0.42)); boss.tw.active = true;
    }
  }

  function playerTile() { const p = Player.pos(); return { tx: p.tx, ty: p.ty }; }
  function hurtPlayer(dmg, sourceTx, opts) {
    const p = Player.pos();
    let sd = 0;
    if (sourceTx > p.tx) sd = 1; else if (sourceTx < p.tx) sd = -1;
    return Player.hurt(dmg, sd, opts) ? 1 : 0;
  }

  // プレイヤーがボスの占有矩形内にいるか
  function occupies(tx, ty) {
    if (!boss || boss.state === "gone") return false;
    return tx >= boss.tx && tx <= boss.tx + boss.w - 1 &&
           ty >= boss.ty && ty <= boss.ty + boss.h - 1;
  }

  // 占有矩形にプレイヤーがいれば接触ダメージ(1回)。
  function checkBodyContact() {
    const p = playerTile();
    if (occupies(p.tx, p.ty)) return hurtPlayer(boss.def.dmg, boss.tx);
    return 0;
  }

  // --- 弾(ボス) ---
  // ground=true: 地面沿い衝撃波(standRow を這う)。それ以外: dx,dy 方向へ直進する音符弾。
  function spawnBullet(tx, ty, dx, dy, speed, ground) {
    bullets.push({
      tx, ty, x: tx, y: ty, dx, dy, speed: speed || 1, ground: !!ground,
      tw: { fromX: tx, fromY: ty, toX: tx, toY: ty, t: 0, dur: 0.001, active: false },
      alive: true,
    });
  }

  function stepBullets() {
    let hits = 0;
    const p = playerTile();
    for (const bl of bullets) {
      if (!bl.alive) continue;
      let nx = bl.tx, ny = bl.ty;
      for (let s = 0; s < bl.speed; s++) {
        const cx = nx + bl.dx, cy = ny + bl.dy;
        if (solid(cx, cy) || cx < 0 || cx >= level.w || cy < 0 || cy >= level.h) { bl.alive = false; break; }
        nx = cx; ny = cy;
        if (nx === p.tx && ny === p.ty) {
          hits += hurtPlayer(boss.def.dmg, nx - bl.dx, { projectile: true });
          bl.alive = false; break;
        }
      }
      if (bl.alive) {
        bl.tw.fromX = bl.x; bl.tw.fromY = bl.y;
        bl.tw.toX = nx; bl.tw.toY = ny; bl.tw.t = 0;
        bl.tw.dur = Math.max(0.001, beatsToSec(0.95)); bl.tw.active = true;
        bl.tx = nx; bl.ty = ny;
      }
    }
    bullets = bullets.filter((b) => b.alive);
    return hits;
  }

  // --- 召喚(既存 Enemies の動的スポーンAPIを使う) ---
  // opts … Enemies.spawn へそのまま渡す(dropHeart等。rev3: サイレンサーのコウモリ召喚のみdropHeart:trueを渡す)。
  function summon(kind, n, opts) {
    if (typeof Enemies === "undefined" || !Enemies.spawn) return;
    const cx = Math.round(bossCenterCol());
    for (let i = 0; i < n; i++) {
      const ox = (i - (n - 1) / 2) * 2;
      const tx = Math.max(arena.playLeft, Math.min(arena.playRight, cx + Math.round(ox)));
      const ty = Math.max(1, boss.ty + boss.h); // ボスの少し下(空中)
      Enemies.spawn(kind, tx, ty, opts);
      effects.push({ type: "summon", x: tx, y: ty, t: 0, dur: 0.35 });
    }
  }

  // ================= 1章: サイレンサー(飛行・2×2) =================
  // ループ: [0-7] 空中を往復しつつプレイヤー上空へ / [8-9] 端でテレグラフ+高さ合わせ /
  //         [10-11] 突進(毎拍3タイル・壁まで) / [12-13] 着地隙(被ダメ1.5倍) / [14] 小コウモリ召喚 / [15] 上昇
  // phase2: 突進2連(1拍の間で往復)・召喚3体。
  function stepSilencer(cb) {
    const pos = cb % boss.d.cycle;
    const p2 = boss.phase >= 2;
    const d = boss.d;
    if (pos <= 7) {
      boss.telegraph = null;
      if (pos % 2 === 0) {
        const pc = playerTile().tx;
        const dir = Math.sign(pc - Math.round(bossCenterCol())) || boss.dir;
        boss.dir = dir;
        moveAnchor(boss.tx + dir, d.airRow);
      }
    } else if (pos === 8) {
      // 最寄りの壁へ寄る(画面端でテレグラフ)
      const goLeft = bossCenterCol() < (arena.startX + CONFIG.STAGE.ARENA_W / 2);
      const nx = goLeft ? arena.playLeft : (arena.playRight - (d.w - 1));
      boss.dashDir = goLeft ? 1 : -1; // 逆側へ突進する
      moveAnchor(nx, d.airRow);
      boss.telegraph = "dash";
      SFX.telegraph(); // 予兆の開始(この位置でのみ1回)
    } else if (pos === 9) {
      // 突進の高さをプレイヤーに合わせる
      const pr = playerTile().ty;
      moveAnchor(boss.tx, clampRowFly(pr - (d.h - 1)));
      boss.telegraph = "dash";
    } else if (pos === 10) {
      boss.telegraph = null;
      dashHoriz();
    } else if (pos === 11) {
      if (!p2) dashHoriz();            // phase1: 突進継続(壁まで)
      // phase2: 1拍の間(往復のあいだ)
    } else if (pos === 12) {
      if (p2) { boss.dashDir = -boss.dashDir; dashHoriz(); }
      else landSilencer();
    } else if (pos === 13) {
      if (p2) landSilencer();
      // phase1: 着地隙の継続(被ダメ1.5倍中)
    } else if (pos === 14) {
      // サイレンサー召喚のコウモリはハートを落とす(rev3・フェーズ2の3体召喚も含む)
      summon("bat", p2 ? 3 : 2, { dropHeart: true });
    } else if (pos === 15) {
      moveAnchor(boss.tx, d.airRow);   // 上昇
    }
  }
  function clampRowFly(ny) {
    return Math.max(1, Math.min(arena.standRow - (boss.h - 1), ny));
  }
  function dashHoriz() {
    let hits = 0;
    for (let s = 0; s < 3; s++) {
      const nx = boss.tx + boss.dashDir;
      if (nx < arena.playLeft || nx > arena.playRight - (boss.w - 1)) break;
      boss.tx = nx;
      hits += checkBodyContact();
    }
    boss.x = boss.tx; // 突進は素早いので即時反映+短トゥイーン
    boss.tw.fromX = boss.tx; boss.tw.toX = boss.tx; boss.tw.active = false;
    return hits;
  }
  function landSilencer() {
    moveAnchor(boss.tx, arena.standRow - (boss.h - 1)); // 地面へ降りる
    boss.vulnUntil = curBeat() + 2; // 隙:2拍のあいだ被ダメ1.5倍
    boss.telegraph = null;
  }

  // ================= 2章: ビートクラッシャー(地上・3×3) =================
  // ループ: [0-3] 前進 / [4-5] テレグラフ(腕振り上げ) / [6] 叩きつけ(両方向に地面弾) /
  //         [12-13] ジャンプ予兆 / [14] プレイヤー位置へ落下(着地3×1+揺れ) / [15] 復帰
  // phase2: 衝撃波2連(6,7拍)・前進が毎拍。
  function stepBeatcrusher(cb) {
    const pos = cb % boss.d.cycle;
    const p2 = boss.phase >= 2;
    if (pos <= 3) {
      boss.telegraph = null;
      const advance = p2 ? true : (pos % 2 === 0);
      if (advance) {
        const pc = playerTile().tx;
        const dir = Math.sign(pc - Math.round(bossCenterCol()));
        if (dir !== 0) { boss.dir = dir; moveAnchor(boss.tx + dir, boss.ty); }
      }
    } else if (pos === 4 || pos === 5) {
      if (pos === 4) SFX.telegraph(); // 予兆の開始(この位置でのみ1回)
      boss.telegraph = "slam";
    } else if (pos === 6) {
      boss.telegraph = null;
      spawnShockwaves();
    } else if (pos === 7) {
      if (p2) spawnShockwaves();       // phase2: 衝撃波2連
    } else if (pos === 12 || pos === 13) {
      if (pos === 12) SFX.telegraph(); // 予兆の開始(この位置でのみ1回)
      boss.telegraph = "jump";
      boss.liftTarget = 2.4;           // 描画上ジャンプで持ち上がる
    } else if (pos === 14) {
      boss.telegraph = null;
      jumpPress();
    } else if (pos === 15) {
      boss.liftTarget = 0;
    }
  }
  function spawnShockwaves() {
    const y = arena.standRow;                 // 地面沿い
    spawnBullet(boss.tx - 1, y, -1, 0, 1, true);
    spawnBullet(boss.tx + boss.w, y, 1, 0, 1, true);
  }
  function jumpPress() {
    // プレイヤーの位置へ落下(中央がプレイヤー列に来るよう着地)
    const pc = playerTile().tx;
    moveAnchor(pc - 1, boss.ty, true);        // 3×3の中央=プレイヤー列
    boss.liftTarget = 0; boss.lift = 0;       // 一気に落下
    // 着地点3×1(ボスの3列 × standRow)へダメージ+画面揺れ
    const y = arena.standRow;
    const p = playerTile();
    let hit = false;
    for (let dx = 0; dx < boss.w; dx++) {
      if (p.tx === boss.tx + dx && p.ty === y) hit = true;
    }
    if (hit) hurtPlayer(boss.def.dmg, p.tx);
    for (let dx = 0; dx < boss.w; dx++) {
      effects.push({ type: "boom", x: boss.tx + dx, y, t: 0, dur: 0.3 });
    }
    pendingShake += 22;
  }

  // ================= 3章: ミュートス(浮遊・2×3) =================
  // ループ: [0] 扇状弾 / [1-4] 移動 / [5-8] 音喰らいテレグラフ / [9-12] 強制休符(移動のみ) /
  //         [13] テレポート(プレイヤーの反対側へ) / [14] wraith召喚 / [15-19] 待機
  // phase2: 扇状弾5方向・テレポート後に接触突進1回。
  function stepMutos(cb) {
    const pos = cb % boss.d.cycle;
    const p2 = boss.phase >= 2;
    if (pos === 0) {
      boss.telegraph = null;
      fanBullets(p2 ? 5 : 3);
    } else if (pos >= 1 && pos <= 4) {
      // 移動(プレイヤー方向へゆっくり寄る)
      const pc = playerTile().tx;
      const dir = Math.sign(pc - Math.round(bossCenterCol()));
      if (dir !== 0 && pos % 2 === 0) { boss.dir = dir; moveAnchor(boss.tx + dir, boss.ty); }
    } else if (pos >= 5 && pos <= 8) {
      if (pos === 5) SFX.telegraph();  // 予兆の開始(この位置でのみ1回)
      boss.telegraph = "devour";       // 音喰らいテレグラフ(4拍)
    } else if (pos === 9) {
      boss.telegraph = null;
      boss.forcedRest = { start: boss.fightStartBeat + cb, len: 4 }; // 次の4拍を強制休符
    } else if (pos >= 10 && pos <= 12) {
      // 強制休符中:移動のみ・攻撃しない
      if (pos % 2 === 0) {
        const dir = boss.dir || 1;
        moveAnchor(boss.tx + dir, boss.ty);
      }
    } else if (pos === 13) {
      teleportOpposite();
    } else if (pos === 14) {
      summon("wraith", 1);
      if (p2) { const pc = playerTile().tx; boss.dashDir = Math.sign(pc - Math.round(bossCenterCol())) || 1; }
    } else if (pos === 15) {
      if (p2) dashHoriz();             // phase2: テレポート後の接触突進1回
    }
  }
  function fanBullets(n) {
    const pc = playerTile().tx;
    const dir = Math.sign(pc - Math.round(bossCenterCol())) || boss.dir || 1;
    boss.dir = dir;
    const sx = dir > 0 ? boss.tx + boss.w : boss.tx - 1;
    const sy = boss.ty + Math.floor(boss.h / 2);
    // 3方向: 水平・上下斜め / 5方向: さらに急角度の上下
    const dys = (n >= 5) ? [-2, -1, 0, 1, 2] : [-1, 0, 1];
    for (const dy of dys) spawnBullet(sx, sy, dir, dy, 1, false);
  }
  function teleportOpposite() {
    const pc = playerTile().tx;
    const mid = arena.startX + CONFIG.STAGE.ARENA_W / 2;
    const toRight = pc < mid;          // プレイヤーが左寄り→右へ
    const nx = toRight ? (arena.playRight - (boss.w - 1)) : arena.playLeft;
    effects.push({ type: "teleport", x: boss.tx + (boss.w - 1) / 2, y: boss.ty + (boss.h - 1) / 2, t: 0, dur: 0.3 });
    moveAnchor(nx, boss.ty, true);
    effects.push({ type: "teleport", x: boss.tx + (boss.w - 1) / 2, y: boss.ty + (boss.h - 1) / 2, t: 0, dur: 0.3 });
  }

  // --- 1整数拍ぶんの処理 ---
  function stepBeat(b) {
    if (!boss) return 0;
    if (boss.state === "intro") {
      if (b >= boss.fightStartBeat) boss.state = "fight";
      else return 0;
    }
    if (boss.state === "dying") {
      if (b >= boss.deathBeat + DYING_BEATS) boss.state = "gone";
      return 0;
    }
    if (boss.state !== "fight") return 0;

    // フェーズ切替(HP50%以下でphase2・不可逆)
    if (boss.phase < 2 && boss.hp <= boss.maxHp * 0.5) boss.phase = 2;

    const cb = b - boss.fightStartBeat;
    switch (boss.kind) {
      case "silencer": stepSilencer(cb); break;
      case "beatcrusher": stepBeatcrusher(cb); break;
      case "mutos": stepMutos(cb); break;
    }

    let hits = stepBullets();
    // 接触ダメージ(強制休符中は攻撃しない=接触も無効)
    if (!isForcedRest()) hits += checkBodyContact();
    return hits;
  }

  // --- 被弾(プレイヤーの攻撃) ---
  // tiles=[{tx,ty}] のどれかがボス占有に当たれば atk ダメージ。着地隙中は1.5倍。
  // 戻り値: [{kind:'boss', boss:true, tx, ty, killed}](当たらなければ [])。
  function damageAt(tiles, atk) {
    if (!boss || boss.state === "gone" || boss.state === "dying") return [];
    for (const t of tiles) {
      if (occupies(t.tx, t.ty)) {
        let dmg = atk;
        if (curBeat() < boss.vulnUntil) dmg = Math.ceil(dmg * VULN_MUL);
        boss.hp -= dmg;
        effects.push({ type: "hit", x: t.tx, y: t.ty, t: 0, dur: 0.18 });
        let killed = false;
        if (boss.hp <= 0) {
          boss.hp = 0;
          boss.state = "dying";
          boss.deathBeat = Math.floor(curBeat());
          boss.telegraph = null;
          killed = true;
          SFX.bossDie();
        }
        return [{ kind: "boss", boss: true, tx: boss.tx, ty: boss.ty, killed }];
      }
    }
    return [];
  }

  // 強制休符が有効か(ミュートスの音喰らい)。game が入力遮断・レーン暗転に流用する。
  function isForcedRest() {
    if (!boss || !boss.forcedRest) return false;
    const b = curBeat();
    return b >= boss.forcedRest.start && b < boss.forcedRest.start + boss.forcedRest.len;
  }

  // 画面揺れ要求を回収(game が毎フレーム呼ぶ)。
  function takeShake() { const s = pendingShake; pendingShake = 0; return s; }

  // --- 毎フレーム更新(拍跨ぎ処理 + トゥイーン補間) ---
  function update(dt, frozen) {
    if (!boss) return 0;
    let hits = 0;
    if (Conductor.running) {
      const curInt = Math.floor(curBeat());
      if (lastBeat === null) {
        lastBeat = curInt;
      } else if (curInt > lastBeat) {
        if (frozen) {
          lastBeat = curInt;             // 曲の休符中はボスも停止
        } else {
          let from = lastBeat + 1;
          if (curInt - from > 8) from = curInt - 8;
          for (let b = from; b <= curInt; b++) hits += stepBeat(b);
          lastBeat = curInt;
        }
      }
    }
    // トゥイーン/リフト/エフェクト(描画補間)
    if (boss.tw.active) {
      boss.tw.t += dt;
      const p = Math.min(1, boss.tw.t / boss.tw.dur);
      const e = easeOut(p);
      boss.x = boss.tw.fromX + (boss.tw.toX - boss.tw.fromX) * e;
      boss.y = boss.tw.fromY + (boss.tw.toY - boss.tw.fromY) * e;
      if (p >= 1) { boss.x = boss.tw.toX; boss.y = boss.tw.toY; boss.tw.active = false; }
    } else {
      boss.x = boss.tx; boss.y = boss.ty;
    }
    boss.lift += (boss.liftTarget - boss.lift) * Math.min(1, dt * 10);
    for (const bl of bullets) {
      if (bl.tw.active) {
        bl.tw.t += dt;
        const pr = Math.min(1, bl.tw.t / bl.tw.dur);
        bl.x = bl.tw.fromX + (bl.tw.toX - bl.tw.fromX) * pr;
        bl.y = bl.tw.fromY + (bl.tw.toY - bl.tw.fromY) * pr;
        if (pr >= 1) bl.tw.active = false;
      }
    }
    for (const fx of effects) fx.t += dt;
    effects = effects.filter((fx) => fx.t < fx.dur);
    return hits;
  }

  // --- 描画 ---
  let camRef = { x: 0, y: 0 };
  function sx(wx) { return (wx - camRef.x) * TILE + VW / 2; }
  function sy(wy) { return (wy - camRef.y) * TILE + VH / 2; }

  function draw(g, cam) {
    if (!boss || boss.state === "gone") return;
    camRef = cam;
    const cur = curBeat();

    // 弾
    for (const bl of bullets) drawBullet(g, bl);

    const cw = boss.w * TILE, ch = boss.h * TILE;
    const cx = sx(boss.x + (boss.w - 1) / 2);
    const cy = sy(boss.y + (boss.h - 1) / 2) - boss.lift * TILE;

    // テレグラフ発光(予兆中は明滅)
    let glow = 0, danger = false;
    if (boss.telegraph) {
      glow = 0.5 + 0.5 * Math.sin(cur * Math.PI * 2);
      danger = (boss.telegraph === "dash" || boss.telegraph === "slam" || boss.telegraph === "jump");
    }
    // 着地隙(被ダメ1.5倍)は黄色く光る
    const vuln = cur < boss.vulnUntil;

    // 撃破演出(点滅)
    let alpha = 1;
    if (boss.state === "dying") {
      const t = cur - boss.deathBeat;
      alpha = 0.35 + 0.35 * (0.5 + 0.5 * Math.sin(cur * Math.PI * 6));
      if (t > DYING_BEATS - 0.5) alpha *= Math.max(0, (DYING_BEATS - t) / 0.5);
    }

    g.save();
    g.globalAlpha = alpha;

    // 影(地上ボスのみ)
    if (!boss.fly) {
      g.globalAlpha = alpha * 0.3;
      g.fillStyle = "#000";
      g.beginPath();
      g.ellipse(cx, sy(arena.standRow + 1) - 2, cw * 0.45, ch * 0.12, 0, 0, Math.PI * 2);
      g.fill();
      g.globalAlpha = alpha;
    }

    // テレグラフのハロー
    if (glow > 0.02) {
      g.globalAlpha = alpha * glow * 0.5;
      g.fillStyle = danger ? "#ff5a6a" : "#b98fff";
      g.beginPath();
      g.ellipse(cx, cy, cw * 0.75, ch * 0.75, 0, 0, Math.PI * 2);
      g.fill();
      g.globalAlpha = alpha;
    }
    if (vuln) {
      g.globalAlpha = alpha * 0.4;
      g.fillStyle = "#ffe08a";
      g.beginPath();
      g.ellipse(cx, cy, cw * 0.7, ch * 0.7, 0, 0, Math.PI * 2);
      g.fill();
      g.globalAlpha = alpha;
    }

    // スプライトがあれば画像描画(現状サイレンサーのみ・idle画像固定)、無ければ従来の図形+目。
    const sprEntry = (boss.kind === "silencer" && typeof Sprites !== "undefined")
      ? Sprites.getEntry("boss_silencer_idle") : null;

    if (sprEntry) {
      // --- スプライト描画(不透明box基準。boxの中心を占有矩形の中心cx,cyへ合わせる) ---
      const box = sprEntry.box;
      const boxH = box.maxy - box.miny + 1;
      const drawH = (boss.h + CONFIG.SPRITE.BOSS_TILES_PLUS) * TILE;
      const spScale = drawH / boxH;
      const srcCx = (box.minx + box.maxx + 1) / 2;
      const srcCy = (box.miny + box.maxy + 1) / 2;

      g.imageSmoothingEnabled = true;
      g.translate(cx, cy);
      if (boss.dir < 0) g.scale(-1, 1); // プレイヤー方向を向くよう水平反転(元画像は正面〜右向き)
      g.scale(spScale, spScale);
      g.drawImage(sprEntry.canvas, -srcCx, -srcCy);
    } else {
      // --- フォールバック:従来の図形+目(スプライト未着のボス種) ---
      const color = boss.phase >= 2 ? boss.d.color2 : boss.d.color;
      g.fillStyle = color;
      if (boss.kind === "silencer") drawSilencer(g, cx, cy, cw, ch);
      else if (boss.kind === "beatcrusher") drawBeatcrusher(g, cx, cy, cw, ch);
      else drawMutos(g, cx, cy, cw, ch);

      drawBossEyes(g, cx, cy - ch * 0.08, cw, boss.dir);
    }
    g.restore();

    // エフェクト
    for (const fx of effects) drawEffect(g, fx);
  }

  function drawSilencer(g, cx, cy, cw, ch) {
    // 大きなコウモリ:三角翼+丸胴
    const r = ch * 0.32;
    g.beginPath();
    g.moveTo(cx, cy);
    g.lineTo(cx - cw * 0.62, cy - ch * 0.34);
    g.lineTo(cx - cw * 0.2, cy + ch * 0.08);
    g.closePath();
    g.moveTo(cx, cy);
    g.lineTo(cx + cw * 0.62, cy - ch * 0.34);
    g.lineTo(cx + cw * 0.2, cy + ch * 0.08);
    g.closePath();
    g.fill();
    g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
    // 耳
    g.beginPath();
    g.moveTo(cx - r * 0.5, cy - r * 0.7); g.lineTo(cx - r * 0.2, cy - r * 1.4); g.lineTo(cx, cy - r * 0.6);
    g.moveTo(cx + r * 0.5, cy - r * 0.7); g.lineTo(cx + r * 0.2, cy - r * 1.4); g.lineTo(cx, cy - r * 0.6);
    g.closePath(); g.fill();
  }
  function drawBeatcrusher(g, cx, cy, cw, ch) {
    // ずんぐりした鋼鉄ゴーレム:角ばった胴+肩
    g.fillRect(cx - cw * 0.4, cy - ch * 0.42, cw * 0.8, ch * 0.84);
    g.fillRect(cx - cw * 0.5, cy - ch * 0.3, cw * 0.14, ch * 0.5); // 左腕
    g.fillRect(cx + cw * 0.36, cy - ch * 0.3, cw * 0.14, ch * 0.5); // 右腕
    // ボルト(装飾)
    g.fillStyle = "rgba(0,0,0,0.28)";
    g.beginPath(); g.arc(cx - cw * 0.22, cy + ch * 0.2, cw * 0.05, 0, Math.PI * 2);
    g.arc(cx + cw * 0.22, cy + ch * 0.2, cw * 0.05, 0, Math.PI * 2); g.fill();
  }
  function drawMutos(g, cx, cy, cw, ch) {
    // 浮遊する音喰らい:縦長の胴+裾の揺らぎ
    g.beginPath();
    g.ellipse(cx, cy - ch * 0.05, cw * 0.42, ch * 0.44, 0, 0, Math.PI * 2);
    g.fill();
    const n = 4;
    g.beginPath();
    g.moveTo(cx - cw * 0.42, cy + ch * 0.3);
    for (let i = 0; i <= n; i++) {
      const px = cx - cw * 0.42 + (cw * 0.84) * (i / n);
      const py = cy + ch * 0.4 + (i % 2 === 0 ? 0 : ch * 0.12);
      g.lineTo(px, py);
    }
    g.lineTo(cx + cw * 0.42, cy + ch * 0.3);
    g.closePath();
    g.fill();
    // 音符マーク
    g.fillStyle = "rgba(255,255,255,0.7)";
    g.font = Math.round(ch * 0.2) + "px sans-serif";
    g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText("♪", cx, cy - ch * 0.02);
    g.textBaseline = "alphabetic";
  }
  function drawBossEyes(g, cx, cy, cw, dir) {
    const r = cw * 0.1;
    g.fillStyle = "#fff";
    g.beginPath();
    g.arc(cx - cw * 0.16, cy, r, 0, Math.PI * 2);
    g.arc(cx + cw * 0.16, cy, r, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#c81030";
    g.beginPath();
    g.arc(cx - cw * 0.16 + dir * r * 0.4, cy, r * 0.5, 0, Math.PI * 2);
    g.arc(cx + cw * 0.16 + dir * r * 0.4, cy, r * 0.5, 0, Math.PI * 2);
    g.fill();
  }

  function drawBullet(g, bl) {
    const cx = sx(bl.x), cy = sy(bl.y);
    if (bl.ground) {
      // 地面沿いの衝撃波:半円+波
      g.fillStyle = "#ffb04a";
      g.beginPath();
      g.arc(cx, cy + TILE * 0.2, TILE * 0.32, Math.PI, 0);
      g.fill();
      g.globalAlpha = 0.5;
      g.fillStyle = "#ffe08a";
      g.beginPath();
      g.arc(cx, cy + TILE * 0.2, TILE * 0.18, Math.PI, 0);
      g.fill();
      g.globalAlpha = 1;
    } else {
      // 音符弾
      g.fillStyle = "#e07fe0";
      g.beginPath();
      g.arc(cx, cy, TILE * 0.18, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = "rgba(255,220,255,0.6)";
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(cx + TILE * 0.16, cy);
      g.lineTo(cx + TILE * 0.16, cy - TILE * 0.3);
      g.stroke();
    }
  }

  function drawEffect(g, fx) {
    const p = fx.t / fx.dur;
    const cx = sx(fx.x), cy = sy(fx.y);
    g.globalAlpha = 1 - p;
    if (fx.type === "boom") {
      g.fillStyle = "#ffcf6b";
      g.beginPath(); g.arc(cx, cy, TILE * (0.3 + p * 0.4), 0, Math.PI * 2); g.fill();
      g.fillStyle = "#ff6b4a";
      g.beginPath(); g.arc(cx, cy, TILE * (0.15 + p * 0.25), 0, Math.PI * 2); g.fill();
    } else if (fx.type === "hit") {
      g.fillStyle = "#fff";
      g.beginPath(); g.arc(cx, cy, TILE * (0.15 + p * 0.25), 0, Math.PI * 2); g.fill();
    } else if (fx.type === "teleport") {
      g.strokeStyle = "#c060ff";
      g.lineWidth = 4;
      g.beginPath(); g.arc(cx, cy, TILE * (0.4 + p * 0.8), 0, Math.PI * 2); g.stroke();
    } else if (fx.type === "summon") {
      g.fillStyle = "#b98fff";
      g.beginPath(); g.arc(cx, cy, TILE * (0.2 + p * 0.3), 0, Math.PI * 2); g.fill();
    }
    g.globalAlpha = 1;
  }

  // 撃破の爆散演出(dying終了→gone直前)を出したい場合の追加(描画は draw のフェードで表現済み)。

  // --- デバッグ ---
  function _debugSetHp(n) { if (boss) { boss.hp = Math.max(1, n); if (boss.hp > boss.maxHp) boss.maxHp = boss.hp; } }
  function _debugInfo() {
    if (!boss) return null;
    const cb = Math.floor(curBeat()) - boss.fightStartBeat;
    return {
      kind: boss.kind, state: boss.state, phase: boss.phase,
      hp: boss.hp, maxHp: boss.maxHp,
      tx: boss.tx, ty: boss.ty, w: boss.w, h: boss.h,
      telegraph: boss.telegraph,
      vulnActive: curBeat() < boss.vulnUntil,
      forcedRest: isForcedRest(),
      cbPos: boss.state === "fight" ? (((cb % boss.d.cycle) + boss.d.cycle) % boss.d.cycle) : -1,
      bullets: bullets.length,
    };
  }

  return {
    reset, spawn, update, draw, damageAt, occupies, isForcedRest, takeShake,
    get active() { return !!boss && boss.state !== "gone"; },
    get spawned() { return !!boss; },
    get name() { return boss ? boss.name : ""; },
    get hp() { return boss ? boss.hp : 0; },
    get maxHp() { return boss ? boss.maxHp : 0; },
    get phase() { return boss ? boss.phase : 1; },
    get state() { return boss ? boss.state : "none"; },
    isDefeated() { return !!boss && boss.state === "gone"; },
    _debugSetHp, _debugInfo,
    _bullets() { return bullets; },
  };
})();
