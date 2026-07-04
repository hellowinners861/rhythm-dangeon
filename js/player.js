// player.js … プレイヤー(拍ゲート式の行動・トゥイーン・重力)
// DESIGN §3。Step2は移動/ジャンプ/重力/タイル衝突のみ(攻撃は空振りモーション)。
//
// 【座標の二重系】
//   tx, ty … タイル座標(整数)。これが「真実」。壁・着地・ゴール判定は全てこれで行う。
//   x, y   … 描画座標(タイル単位の小数)。トゥイーン/重力で tx,ty に追従する「見た目」。
// 【時計の区別】
//   トゥイーンの所要秒は「拍→秒」換算(60/bpm × 拍数)で決めるが、
//   進行そのものは update(dt) の rAF delta で進める(拍計算には使わない=描画系)。

const Player = (() => {
  let level = null;

  // 真実のタイル座標
  let tx = 0, ty = 0;
  // 描画座標(タイル単位)
  let x = 0, y = 0;
  let dir = 1; // 向き(+1=右 / -1=左)
  let state = "idle"; // "idle" | "move" | "jump" | "fall"

  // 横トゥイーン(全状態で共通。x を xEnd へイーズ)
  const xt = { from: 0, end: 0, t: 0, dur: 0.001, active: false };
  // 縦トゥイーン(接地時の駆け上がり/降りの見た目のみ)
  const yt = { from: 0, end: 0, t: 0, dur: 0.001, active: false };

  // ジャンプ上昇
  const jump = { from: 0, peak: 0, t: 0, dur: 0.001 };
  // 落下
  let vy = 0;        // 落下速度(タイル/s)
  let landY = 0;     // 着地予定タイル行

  // 攻撃の空振りモーション(見た目のみ)
  let attack = { t: 0, dur: 0, dir: 1 };

  const P = () => CONFIG.PHYSICS;

  // 拍→秒(トゥイーン所要時間の換算)
  function beatsToSec(beats) {
    const bpm = (Conductor && Conductor.bpm) ? Conductor.bpm : CONFIG.METRONOME.BPM;
    return (60 / bpm) * beats;
  }

  function solid(cx, cy) {
    return LevelGen.solidAt(level, cx, cy);
  }

  function airborne() {
    return state === "jump" || state === "fall";
  }

  function easeOut(p) {
    // イーズアウト(3次)
    const q = 1 - p;
    return 1 - q * q * q;
  }

  function init(lv) {
    level = lv;
    tx = level.startX;
    ty = level.startY;
    x = tx; y = ty;
    dir = 1;
    state = "idle";
    xt.active = false; yt.active = false;
    vy = 0;
    attack = { t: 0, dur: 0, dir: 1 };
    // 開始位置の足元が空なら落下から始める(安全策)
    if (!solid(tx, ty + 1)) startFall();
  }

  // --- トゥイーン開始ヘルパ ---
  function startXTween(end, dur) {
    xt.from = x; xt.end = end; xt.t = 0; xt.dur = Math.max(0.001, dur); xt.active = true;
  }
  function startYTween(end, dur) {
    yt.from = y; yt.end = end; yt.t = 0; yt.dur = Math.max(0.001, dur); yt.active = true;
  }

  // 着地予定行を tx 列で算出(cy の直下から下方向に最初の床の上)
  function computeLanding(cy) {
    let ly = cy;
    while (!solid(tx, ly + 1)) ly++;
    return ly;
  }

  function startFall() {
    state = "fall";
    vy = 0;
    landY = computeLanding(ty);
    yt.active = false;
  }

  // --- 行動(判定成立=PERFECT/GOOD の拍でのみ game から呼ばれる) ---
  function act(type, verdict) {
    if (type === "attack") { doAttack(); return; }
    if (type === "left" || type === "right") {
      const d = type === "right" ? 1 : -1;
      dir = d;
      if (airborne()) airControl(d);
      else groundMove(d);
      return;
    }
    if (type === "jump") { doJump(); return; }
  }

  // 接地時の前進ダッシュ(段差の自動駆け上がり/降りを含む)
  function groundMove(d) {
    const moveSec = beatsToSec(P().MOVE_TWEEN_BEATS);
    const ntx = tx + d;
    const frontSolid = solid(ntx, ty);       // 進行先の体の高さ
    if (frontSolid) {
      // 駆け上がり判定:進行先の1つ上が空き、かつ自分の頭上が空き
      const aboveFront = solid(ntx, ty - 1);
      const head = solid(tx, ty - 1);
      if (!aboveFront && !head) {
        tx = ntx; ty -= 1;
        startXTween(tx, moveSec);
        startYTween(ty, moveSec);
        state = "move";
      }
      // 駆け上がり不可の壁 → その場で向きだけ変える(成立扱い・移動なし)
      return;
    }
    // 進行先が空き → 前進。着地の有無は移動完了時に判断
    tx = ntx;
    startXTween(tx, moveSec);
    yt.active = false;
    state = "move";
  }

  // 空中制御:横1タイルぶん描画目標をずらす(壁があれば成立扱いで無視)
  function airControl(d) {
    const moveSec = beatsToSec(P().MOVE_TWEEN_BEATS);
    const ntx = tx + d;
    if (solid(ntx, ty)) return; // 壁 → 無視(成立扱い)
    tx = ntx;
    startXTween(tx, moveSec);
    if (state === "fall") landY = computeLanding(ty); // 着地予定を更新
  }

  function doJump() {
    if (airborne()) return; // 接地時のみ
    // 頭上の空きぶんだけ上昇(天井があれば手前まで)
    let rise = P().JUMP_RISE_TILES;
    for (let i = 1; i <= P().JUMP_RISE_TILES; i++) {
      if (solid(tx, ty - i)) { rise = i - 1; break; }
    }
    const peak = ty - rise;
    ty = peak; // 真実のタイルは即上昇(描画はイーズで追従)
    jump.from = y; jump.peak = peak; jump.t = 0;
    jump.dur = Math.max(0.001, beatsToSec(P().JUMP_RISE_BEATS));
    xt.active = false;
    state = "jump";
  }

  function doAttack() {
    attack = { t: 0, dur: 0.18, dir };
  }

  // --- 毎フレーム更新(描画・トゥイーン専用。拍計算には使わない) ---
  function update(dt) {
    // 攻撃モーション
    if (attack.dur > 0) {
      attack.t += dt;
      if (attack.t >= attack.dur) attack.dur = 0;
    }

    // 横トゥイーン(全状態共通)
    if (xt.active) {
      xt.t += dt;
      const p = Math.min(1, xt.t / xt.dur);
      x = xt.from + (xt.end - xt.from) * easeOut(p);
      if (p >= 1) { x = xt.end; xt.active = false; }
    }

    if (state === "move") {
      // 縦(駆け上がり/降りの見た目)
      if (yt.active) {
        yt.t += dt;
        const p = Math.min(1, yt.t / yt.dur);
        y = yt.from + (yt.end - yt.from) * easeOut(p);
        if (p >= 1) { y = yt.end; yt.active = false; }
      }
      // 横縦とも終わったら完了処理
      if (!xt.active && !yt.active) {
        x = tx; y = ty;
        if (!solid(tx, ty + 1)) startFall(); // 足元が空なら落下へ
        else state = "idle";
      }
    } else if (state === "jump") {
      jump.t += dt;
      const p = Math.min(1, jump.t / jump.dur);
      y = jump.from + (jump.peak - jump.from) * easeOut(p);
      if (p >= 1) { y = jump.peak; startFall(); } // 頂点で落下へ
    } else if (state === "fall") {
      vy = Math.min(P().MAX_FALL_TILES, vy + P().GRAVITY_TILES * dt);
      y += vy * dt;
      if (y >= landY) { // 着地
        y = landY; ty = landY; x = tx;
        vy = 0;
        state = "idle";
      }
    } else {
      // idle:描画座標を真実に保つ
      if (!xt.active) x = tx;
      y = ty;
    }
  }

  // --- 描画(cam.x, cam.y はタイル単位で画面中央に映すワールド座標) ---
  function draw(g, cam) {
    const TILE = CONFIG.TILE;
    const VW = CONFIG.VIEW.W, VH = CONFIG.VIEW.H;
    const cx = (x - cam.x) * TILE + VW / 2;      // タイル中心のスクリーンX
    const cy = (y - cam.y) * TILE + VH / 2;      // タイル中心のスクリーンY
    const r = TILE * 0.42;

    // 攻撃の突き量
    let thrust = 0, atkAlpha = 0;
    if (attack.dur > 0) {
      const ap = attack.t / attack.dur;
      const bump = Math.sin(ap * Math.PI); // 0→1→0
      thrust = bump * TILE * 0.5 * attack.dir;
      atkAlpha = 1 - ap;
    }

    // 影
    g.fillStyle = "rgba(0,0,0,0.32)";
    g.beginPath();
    g.ellipse(cx, cy + r * 0.95, r * 0.85, r * 0.28, 0, 0, Math.PI * 2);
    g.fill();

    // 体
    g.fillStyle = airborne() ? "#8fd3ff" : "#7fb0ff";
    g.beginPath();
    g.arc(cx + thrust * 0.3, cy, r, 0, Math.PI * 2);
    g.fill();

    // 目(向きに応じてオフセット)
    const ex = cx + thrust * 0.3 + dir * r * 0.22;
    g.fillStyle = "#fff";
    g.beginPath();
    g.arc(ex - r * 0.18, cy - r * 0.18, r * 0.22, 0, Math.PI * 2);
    g.arc(ex + r * 0.18, cy - r * 0.18, r * 0.22, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#12141c";
    g.beginPath();
    g.arc(ex - r * 0.14 + dir * 3, cy - r * 0.16, r * 0.1, 0, Math.PI * 2);
    g.arc(ex + r * 0.22 + dir * 3, cy - r * 0.16, r * 0.1, 0, Math.PI * 2);
    g.fill();

    // 攻撃エフェクト(前方の円)
    if (atkAlpha > 0) {
      g.globalAlpha = atkAlpha;
      g.strokeStyle = "#ffe08a";
      g.lineWidth = 5;
      g.beginPath();
      g.arc(cx + dir * TILE * 0.7, cy, TILE * 0.32, 0, Math.PI * 2);
      g.stroke();
      g.globalAlpha = 1;
    }
  }

  function pos() {
    return { tx, ty, x, y, dir, state };
  }

  return { init, act, update, draw, pos };
})();
