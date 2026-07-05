// player.js … プレイヤー(拍ゲート式の行動・トゥイーン・重力・戦闘)
// DESIGN §3/§5。Step4で 3キャラの攻撃・HP・被弾・無敵・ノックバックを追加。
//
// 【座標の二重系】
//   tx, ty … タイル座標(整数)。これが「真実」。壁・着地・ゴール判定は全てこれで行う。
//   x, y   … 描画座標(タイル単位の小数)。トゥイーン/重力で tx,ty に追従する「見た目」。
// 【時計の区別】
//   トゥイーンの所要秒は「拍→秒」換算(60/bpm × 拍数)で決めるが、
//   進行そのものは update(dt) の rAF delta で進める(拍計算には使わない=描画系)。
//   無敵・リロードの残り拍数の判定は Conductor.currentBeat()(=AudioContext時計)で行う。

const Player = (() => {
  let level = null;

  // 真実のタイル座標
  let tx = 0, ty = 0;
  // 描画座標(タイル単位)
  let x = 0, y = 0;
  let dir = 1; // 向き(+1=右 / -1=左)
  let state = "idle"; // "idle" | "move" | "jump" | "fall"

  // キャラ定義・戦闘状態
  let charId = "rat";
  let char = null;
  let hp = 3, maxHp = 3;
  let invulnUntilBeat = 0;   // この拍まで無敵(拍基準)
  let reloadUntilBeat = 0;   // ガンナー:この拍までビーム不可
  let hurtCount = 0;         // 被弾成立の累計(ゲーム側が演出検出に使う)

  // 横トゥイーン(全状態で共通。x を xEnd へイーズ)
  const xt = { from: 0, end: 0, t: 0, dur: 0.001, active: false };
  // 縦トゥイーン(接地時の駆け上がり/降りの見た目のみ)
  const yt = { from: 0, end: 0, t: 0, dur: 0.001, active: false };

  // ジャンプ上昇
  const jump = { from: 0, peak: 0, t: 0, dur: 0.001 };
  // 落下
  let vy = 0;        // 落下速度(タイル/s)
  let landY = 0;     // 着地予定タイル行

  // 攻撃モーション(見た目)。type=tackle/sword/beam/beamfail
  let attack = { t: 0, dur: 0, dir: 1, type: "tackle", beamEndTx: 0 };

  const P = () => CONFIG.PHYSICS;

  // 拍→秒(トゥイーン所要時間の換算)
  function beatsToSec(beats) {
    const bpm = (Conductor && Conductor.bpm) ? Conductor.bpm : CONFIG.METRONOME.BPM;
    return (60 / bpm) * beats;
  }
  function curBeat() {
    return (Conductor && Conductor.running) ? Conductor.currentBeat() : 0;
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

  function init(lv, cid) {
    level = lv;
    charId = (cid && CONFIG.CHARACTERS[cid]) ? cid : "rat";
    char = CONFIG.CHARACTERS[charId];
    maxHp = char.hp;
    hp = char.hp;
    invulnUntilBeat = 0;
    reloadUntilBeat = -1e9; // 開始前(負の拍)でもビームを撃てるように十分過去にしておく
    hurtCount = 0;

    tx = level.startX;
    ty = level.startY;
    x = tx; y = ty;
    dir = 1;
    state = "idle";
    xt.active = false; yt.active = false;
    vy = 0;
    attack = { t: 0, dur: 0, dir: 1, type: "tackle", beamEndTx: 0 };
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

  // 敵タイルへ「攻撃以外で」進入した際の接触ダメージ(移動はキャンセルしない)。
  function maybeTouch(d) {
    if (typeof Enemies === "undefined") return;
    const e = Enemies.enemyAt(tx, ty);
    if (e) hurt(e.def.dmg, d);
  }

  // --- 行動(判定成立=PERFECT/GOOD の拍でのみ game から呼ばれる) ---
  // opts.fever … フィーバー中(攻撃倍率)
  function act(type, verdict, opts) {
    if (type === "attack") { doAttack(opts || {}); return; }
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
        maybeTouch(d);
      }
      // 駆け上がり不可の壁 → その場で向きだけ変える(成立扱い・移動なし)
      return;
    }
    // 進行先が空き → 前進。着地の有無は移動完了時に判断
    tx = ntx;
    startXTween(tx, moveSec);
    yt.active = false;
    state = "move";
    maybeTouch(d);
  }

  // 空中制御:横1タイルぶん描画目標をずらす(壁があれば成立扱いで無視)
  function airControl(d) {
    const moveSec = beatsToSec(P().MOVE_TWEEN_BEATS);
    const ntx = tx + d;
    if (solid(ntx, ty)) return; // 壁 → 無視(成立扱い)
    tx = ntx;
    startXTween(tx, moveSec);
    if (state === "fall") landY = computeLanding(ty); // 着地予定を更新
    maybeTouch(d);
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
    maybeTouch(0);
  }

  // --- 攻撃(キャラ固有) ---
  function attackPower(opts) {
    let a = char.atk;
    if (opts && opts.fever) a = Math.ceil(a * CONFIG.COMBAT.FEVER_ATK_MUL);
    return a;
  }

  function doAttack(opts) {
    if (char.type === "tackle") doTackle(opts);
    else if (char.type === "sword") doSword(opts);
    else if (char.type === "beam") doBeam(opts);
  }

  // ラット:前方 tackleTiles へ突進。経路上の敵に順次ダメージ。生存敵の手前で停止。
  function doTackle(opts) {
    const atk = attackPower(opts);
    const tiles = char.tackleTiles || 2;
    let reached = tx;
    for (let i = 0; i < tiles; i++) {
      const nx = reached + dir;
      if (solid(nx, ty)) break;                    // 壁 → 手前まで
      const e = (typeof Enemies !== "undefined") ? Enemies.enemyAt(nx, ty) : null;
      if (e) {
        const res = Enemies.damageAt([{ tx: nx, ty }], atk);
        const killed = res.some((r) => r.killed);
        if (killed) { reached = nx; continue; }    // 倒した → 通り抜ける
        break;                                     // 生存 → 手前で停止(すり抜けない)
      }
      reached = nx;
    }
    if (reached !== tx) {
      tx = reached;
      startXTween(tx, beatsToSec(P().MOVE_TWEEN_BEATS));
      if (airborne()) {
        if (state === "fall") landY = computeLanding(ty);
      } else {
        yt.active = false;
        state = "move";
      }
    }
    attack = { t: 0, dur: 0.18, dir, type: "tackle", beamEndTx: 0 };
  }

  // ソードマン:前方1タイル(+その頭上1タイル)へ攻撃。移動なし。
  function doSword(opts) {
    const atk = attackPower(opts);
    const tiles = [{ tx: tx + dir, ty }, { tx: tx + dir, ty: ty - 1 }];
    if (typeof Enemies !== "undefined") Enemies.damageAt(tiles, atk);
    attack = { t: 0, dur: 0.2, dir, type: "sword", beamEndTx: 0 };
  }

  // ガンナー:前方直線(壁まで)を貫通攻撃。reloadBeats の間は攻撃不可(移動は可)。
  function doBeam(opts) {
    if (curBeat() < reloadUntilBeat) {
      attack = { t: 0, dur: 0.12, dir, type: "beamfail", beamEndTx: tx }; // 不発
      return;
    }
    const atk = attackPower(opts);
    const tiles = [];
    let cx = tx + dir;
    while (!solid(cx, ty) && cx >= 0 && cx < level.w) { tiles.push({ tx: cx, ty }); cx += dir; }
    if (typeof Enemies !== "undefined") Enemies.damageAt(tiles, atk);
    reloadUntilBeat = curBeat() + (char.reloadBeats || 1);
    attack = { t: 0, dur: 0.16, dir, type: "beam", beamEndTx: cx - dir };
  }

  // --- 被弾 ---
  // sourceDir … 攻撃源の方向(+1=右 / -1=左 / 0=同タイル)。ノックバックは逆方向。
  function hurt(dmg, sourceDir) {
    if (hp <= 0) return false;
    if (isInvulnerable()) return false;
    hp -= dmg;
    if (hp < 0) hp = 0;

    // ノックバック(壁なら0)
    let kb = -Math.sign(sourceDir || 0);
    if (kb === 0) kb = -dir;
    let moved = false;
    for (let i = 0; i < CONFIG.COMBAT.KNOCKBACK_TILES; i++) {
      const nx = tx + kb;
      if (solid(nx, ty)) break;
      tx = nx; moved = true;
    }
    if (moved) {
      startXTween(tx, beatsToSec(P().MOVE_TWEEN_BEATS));
      if (!airborne()) {
        if (!solid(tx, ty + 1)) startFall(); // 足場外へ弾かれたら落下
      } else if (state === "fall") {
        landY = computeLanding(ty);
      }
    }
    invulnUntilBeat = curBeat() + CONFIG.COMBAT.INVULN_BEATS;
    hurtCount++;
    return true;
  }

  function isInvulnerable() {
    if (!(Conductor && Conductor.running)) return false;
    return curBeat() < invulnUntilBeat;
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

    // 攻撃の突き量(タックルのみ体を突き出す)
    let thrust = 0, atkAlpha = 0, ap = 0;
    if (attack.dur > 0) {
      ap = attack.t / attack.dur;
      const bump = Math.sin(ap * Math.PI); // 0→1→0
      if (attack.type === "tackle") thrust = bump * TILE * 0.5 * attack.dir;
      atkAlpha = 1 - ap;
    }

    // ビーム(貫通線)は体より先に描く
    if (attack.dur > 0 && attack.type === "beam") {
      const ex = (attack.beamEndTx - cam.x) * TILE + VW / 2;
      g.globalAlpha = atkAlpha;
      g.strokeStyle = "#ff6b6b";
      g.lineWidth = 10 * (0.4 + 0.6 * atkAlpha);
      g.beginPath();
      g.moveTo(cx + attack.dir * r, cy);
      g.lineTo(ex + attack.dir * TILE * 0.5, cy);
      g.stroke();
      g.strokeStyle = "#ffd0d0";
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(cx + attack.dir * r, cy);
      g.lineTo(ex + attack.dir * TILE * 0.5, cy);
      g.stroke();
      g.globalAlpha = 1;
    }

    // 無敵中は点滅(演出のみ・performance.now)
    let bodyAlpha = 1;
    if (isInvulnerable()) {
      bodyAlpha = 0.35 + 0.35 * (0.5 + 0.5 * Math.sin(performance.now() / 60));
    }

    g.save();
    g.globalAlpha = bodyAlpha;

    // 影
    g.globalAlpha = bodyAlpha * 0.32;
    g.fillStyle = "#000";
    g.beginPath();
    g.ellipse(cx, cy + r * 0.95, r * 0.85, r * 0.28, 0, 0, Math.PI * 2);
    g.fill();
    g.globalAlpha = bodyAlpha;

    // 体(キャラ色)
    g.fillStyle = airborne() ? shade(char.color, 1.12) : char.color;
    g.beginPath();
    g.arc(cx + thrust * 0.3, cy, r, 0, Math.PI * 2);
    g.fill();

    // 目(向きに応じてオフセット)
    const ex2 = cx + thrust * 0.3 + dir * r * 0.22;
    g.fillStyle = "#fff";
    g.beginPath();
    g.arc(ex2 - r * 0.18, cy - r * 0.18, r * 0.22, 0, Math.PI * 2);
    g.arc(ex2 + r * 0.18, cy - r * 0.18, r * 0.22, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#12141c";
    g.beginPath();
    g.arc(ex2 - r * 0.14 + dir * 3, cy - r * 0.16, r * 0.1, 0, Math.PI * 2);
    g.arc(ex2 + r * 0.22 + dir * 3, cy - r * 0.16, r * 0.1, 0, Math.PI * 2);
    g.fill();
    g.restore();

    // 攻撃エフェクト(タックル=前方の円 / 剣=弧 / ビーム不発=×)
    if (atkAlpha > 0 && attack.type === "tackle") {
      g.globalAlpha = atkAlpha;
      g.strokeStyle = "#ffe08a";
      g.lineWidth = 5;
      g.beginPath();
      g.arc(cx + dir * TILE * 0.7, cy, TILE * 0.32, 0, Math.PI * 2);
      g.stroke();
      g.globalAlpha = 1;
    } else if (atkAlpha > 0 && attack.type === "sword") {
      // 前方に弧を描く斬撃
      g.globalAlpha = atkAlpha;
      g.strokeStyle = "#eaffea";
      g.lineWidth = 7;
      const a0 = attack.dir > 0 ? -Math.PI * 0.6 : Math.PI * 0.4;
      const a1 = attack.dir > 0 ? Math.PI * 0.6 : Math.PI * 1.6;
      g.beginPath();
      g.arc(cx + attack.dir * TILE * 0.5, cy - TILE * 0.1, TILE * 0.7, a0, a1);
      g.stroke();
      g.globalAlpha = 1;
    } else if (atkAlpha > 0 && attack.type === "beamfail") {
      // リロード中の不発(×印)
      g.globalAlpha = atkAlpha;
      g.strokeStyle = "#8f9bbf";
      g.lineWidth = 4;
      const bx = cx + dir * TILE * 0.6;
      g.beginPath();
      g.moveTo(bx - 8, cy - 8); g.lineTo(bx + 8, cy + 8);
      g.moveTo(bx + 8, cy - 8); g.lineTo(bx - 8, cy + 8);
      g.stroke();
      g.globalAlpha = 1;
    }
  }

  // 色を明るく/暗くする簡易ヘルパ(#rrggbb 前提)
  function shade(hex, mul) {
    const n = parseInt(hex.slice(1), 16);
    const R = Math.min(255, Math.round(((n >> 16) & 255) * mul));
    const G = Math.min(255, Math.round(((n >> 8) & 255) * mul));
    const B = Math.min(255, Math.round((n & 255) * mul));
    return `rgb(${R},${G},${B})`;
  }

  function pos() {
    return { tx, ty, x, y, dir, state };
  }

  // デバッグ用:プレイヤーを指定タイルへ即移動(検証のゴール到達テスト等で使用)
  function _debugSetTile(ntx, nty) {
    tx = ntx; ty = nty; x = ntx; y = nty;
    state = "idle"; vy = 0;
    xt.active = false; yt.active = false;
  }

  return {
    init, act, update, draw, pos, hurt, isInvulnerable, _debugSetTile,
    get hp() { return hp; },
    get maxHp() { return maxHp; },
    get charId() { return charId; },
    get charName() { return char ? char.name : ""; },
    get hurtCount() { return hurtCount; },
    isDead() { return hp <= 0; },
  };
})();
