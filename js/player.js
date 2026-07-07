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
  let hp = 3, maxHp = 3;     // 装備のdefMulで0.5刻みが出るため小数対応
  let shield = 0;            // シールドベスト等。1以上なら被弾ダメージを1回無効化
  let revivedUsed = false;   // 不死鳥の羽衣の復活を使い切ったか(1ステージ1回)
  let invulnUntilBeat = 0;   // この拍まで無敵(拍基準)
  let reloadUntilBeat = 0;   // ガンナー:この拍までビーム不可
  let hurtCount = 0;         // 被弾成立の累計(ゲーム側が演出検出に使う)
  let boostUntilBeat = -1e9; // ブーストアイテムの効果終了拍(拾得アイテム・DESIGN §8・Step7)
  let boostTrail = [];       // ブースト中の残像演出用の直近描画位置履歴(演出のみ)

  // 2段ジャンプ(改修バッチ)。着地時に0へリセット。CONFIG.PHYSICS.AIR_JUMPS回まで空中ジャンプ可能。
  let airJumpsUsed = 0;
  let airPoof = null; // 空中ジャンプの足元エフェクト(演出のみ){x,y,t,dur}

  // game.js から毎入力時に渡される戦闘コンテキスト(PlayerからGameは参照しない)
  let combatCtx = { combo: 0, fever: false };

  // Equip未ロード時のフォールバック(全て無効果)
  const EMPTY_STATS = {
    defMul: 1, projDefMul: 1, knockbackMul: 1, coinMul: 1,
    maxHp: 0, atk: 0, atkPerfect: 0, feverReq: 0, goodWindow: 0, perfectWindow: 0,
    shieldStart: 0, thorns: 0, jumpPlus: 0, airControlPlus: 0, magnet: 0, feverAtk: 0,
    moveDist: 1, vampire: 0, comboAtkStep: 0, comboAtkMax: 0,
    pierce: false, blast: false, feverLightning: false, revive: false,
    stealth: false, missComboHalf: false, lavaImmune: false,
  };

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

  function getStats() {
    return (typeof Equip !== "undefined") ? Equip.stats() : EMPTY_STATS;
  }

  // 攻撃タイルのダメージ解決。ザコ(Enemies)とボス(Boss)の両方へ当てる(DESIGN §10・Step8)。
  // 戻り値は撃破座標つきの結果配列(game側のblast/vampire・撃破検出に使う)。
  function dealDamage(tiles, atk) {
    let out = [];
    if (typeof Enemies !== "undefined") out = Enemies.damageAt(tiles, atk);
    if (typeof Boss !== "undefined" && Boss.active) {
      const br = Boss.damageAt(tiles, atk);
      if (br && br.length) out = out.concat(br);
    }
    return out;
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
    const stats = getStats();
    maxHp = char.hp + stats.maxHp;
    hp = maxHp;
    shield = stats.shieldStart;
    revivedUsed = false;
    invulnUntilBeat = 0;
    reloadUntilBeat = -1e9; // 開始前(負の拍)でもビームを撃てるように十分過去にしておく
    hurtCount = 0;
    boostUntilBeat = -1e9;
    boostTrail = [];
    airJumpsUsed = 0;
    airPoof = null;

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
  // とげの鎧(thorns): 接触した敵へ反撃ダメージを返す(Enemies.damageAt利用)。
  function maybeTouch(d) {
    if (typeof Enemies === "undefined") return;
    const e = Enemies.enemyAt(tx, ty);
    if (!e) return;
    hurt(e.def.dmg, d);
    const stats = getStats();
    if (stats.thorns > 0) Enemies.damageAt([{ tx: e.tx, ty: e.ty }], stats.thorns);
  }

  // --- 行動(判定成立=PERFECT/GOOD の拍でのみ game から呼ばれる) ---
  // 戻り値: 攻撃時は Enemies.damageAt の結果配列([{kind,tx,ty,killed}])。それ以外は []。
  // game側の blast/vampire 処理に使う(撃破座標が必要なため)。
  function act(type, verdict, opts) {
    if (type === "attack") return doAttack(verdict) || [];
    if (type === "left" || type === "right") {
      const d = type === "right" ? 1 : -1;
      dir = d;
      if (airborne()) airControl(d);
      else groundMove(d);
      SFX.dash(); // 判定成立時のみ呼ばれる(actは成立拍でのみgameから呼ばれる)
      return [];
    }
    if (type === "jump") {
      const wasAirborne = airborne(); // 空中ジャンプ(2段ジャンプ)かどうかで効果音のピッチを変える
      doJump();
      SFX.jump(wasAirborne);
      return [];
    }
    return [];
  }

  // game.js から毎入力時に呼ばれる戦闘コンテキスト更新(コンボ数・フィーバー中か)。
  // PlayerからGameを直接参照しないための一方向の受け渡し。
  function setCombatContext(ctx) {
    combatCtx.combo = (ctx && typeof ctx.combo === "number") ? ctx.combo : 0;
    combatCtx.fever = !!(ctx && ctx.fever);
  }

  // 吸血の牙(vampire)等の回復。上限maxHpでクランプする。
  function heal(amount) {
    if (hp <= 0) return;
    hp = Math.min(maxHp, hp + amount);
  }

  // シールド拾得アイテム。CONFIG.ITEMS.SHIELD_MAX を上限にクランプする(DESIGN §8・Step7)。
  function addShield(n) {
    const max = (typeof CONFIG !== "undefined" && CONFIG.ITEMS) ? CONFIG.ITEMS.SHIELD_MAX : 2;
    shield = Math.min(max, shield + n);
  }

  // ブースト拾得アイテム。現在拍から beats 拍のあいだ移動距離2倍(羽の靴と重複しても最大値採用)。
  function setBoost(beats) {
    boostUntilBeat = curBeat() + beats;
  }

  // ブースト効果が有効か(1拍あたりの移動距離2倍)
  function isBoosted() {
    return (Conductor && Conductor.running) && curBeat() < boostUntilBeat;
  }

  // HUD表示用の残り拍数(効果なしなら0)
  function boostRemaining() {
    if (!isBoosted()) return 0;
    return Math.max(0, boostUntilBeat - curBeat());
  }

  // 接地時の前進ダッシュ(段差の自動駆け上がり/降りを含む)。
  // 羽の靴(moveDist:2)またはブースト拾得アイテム中なら1拍で前方2タイル進む(重複しても最大値採用)。
  // 段差処理・停止判定は1タイル目のみで行い、1タイル目で壁に当たればそこで停止する(2タイル目の駆け上がりは試みない)。
  function groundMove(d) {
    const stats = getStats();
    const dist = (stats.moveDist >= 2 || isBoosted()) ? 2 : 1;
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
    maybeTouch(d);
    // 2タイル目(羽の靴)。壁があればそこで停止(段差処理はしない)
    if (dist >= 2 && !solid(tx + d, ty)) {
      tx += d;
      maybeTouch(d);
    }
    startXTween(tx, moveSec);
    yt.active = false;
    state = "move";
  }

  // 空中制御:横方向に移動目標をずらす(バネブーツ/韋駄天足袋で1+airControlPlusタイル)。
  // 壁があれば手前で止める(成立扱い)。
  function airControl(d) {
    const stats = getStats();
    const dist = 1 + stats.airControlPlus;
    const moveSec = beatsToSec(P().MOVE_TWEEN_BEATS);
    let reached = tx;
    for (let i = 0; i < dist; i++) {
      const nx = reached + d;
      if (solid(nx, ty)) break;
      reached = nx;
    }
    if (reached === tx) return; // 壁で完全に阻まれた → 無視(成立扱い)
    tx = reached;
    startXTween(tx, moveSec);
    if (state === "fall") landY = computeLanding(ty); // 着地予定を更新
    maybeTouch(d);
  }

  // 通常ジャンプ(接地時)+空中ジャンプ(2段ジャンプ・改修バッチ)。
  // 空中ジャンプはCONFIG.PHYSICS.AIR_JUMPS回まで(jump上昇中/fall中いずれからも可)。
  // 基点は「現在の描画位置に最も近いタイル行」(fall中は tx,ty が更新されないため y を使う)。
  function doJump() {
    const stats = getStats();
    const riseTiles = P().JUMP_RISE_TILES + stats.jumpPlus; // うさぎの靴/韋駄天足袋

    if (!airborne()) {
      // 接地時:従来どおりのジャンプ。空中ジャンプ回数をリセット。
      let rise = riseTiles;
      for (let i = 1; i <= riseTiles; i++) {
        if (solid(tx, ty - i)) { rise = i - 1; break; }
      }
      const peak = ty - rise;
      ty = peak; // 真実のタイルは即上昇(描画はイーズで追従)
      jump.from = y; jump.peak = peak; jump.t = 0;
      jump.dur = Math.max(0.001, beatsToSec(P().JUMP_RISE_BEATS));
      xt.active = false;
      state = "jump";
      airJumpsUsed = 0;
      maybeTouch(0);
      return;
    }

    // 空中(jump上昇中 or fall中):空中ジャンプ。回数切れなら不発(成立扱いだが何も起きない)。
    const maxAirJumps = P().AIR_JUMPS || 0;
    if (airJumpsUsed >= maxAirJumps) return;
    airJumpsUsed++;

    const baseRow = Math.round(y); // 現在の描画位置に最も近いタイル行を基点にする
    let rise = riseTiles;
    for (let i = 1; i <= riseTiles; i++) {
      if (solid(tx, baseRow - i)) { rise = i - 1; break; }
    }
    const peak = baseRow - rise;
    ty = peak; // fallを打ち切ってjumpへ(着地予定はstartFallが頂点到達時に再計算する)
    jump.from = y; jump.peak = peak; jump.t = 0;
    jump.dur = Math.max(0.001, beatsToSec(P().JUMP_RISE_BEATS));
    xt.active = false;
    state = "jump";
    airPoof = { x, y, t: 0, dur: 0.35 }; // 足元に雲エフェクト(演出のみ)
    maybeTouch(0);
  }

  // --- 攻撃(キャラ固有) ---
  // 攻撃力を1関数に集約(DESIGN §9 Step6):
  //   基礎atk + 装備atk + (PERFECT時)atkPerfect + (フィーバー中)feverAtk + コンボ本数ボーナス。
  //   フィーバー倍率(FEVER_ATK_MUL)はその合計へ最後に乗算して切り上げる。
  function atkTotal(verdict) {
    const stats = getStats();
    let a = char.atk + stats.atk;
    if (verdict === "PERFECT") a += stats.atkPerfect;
    if (combatCtx.fever) a += stats.feverAtk;
    if (stats.comboAtkStep > 0) {
      a += Math.min(stats.comboAtkMax, Math.floor(combatCtx.combo / stats.comboAtkStep));
    }
    if (combatCtx.fever) a = Math.ceil(a * CONFIG.COMBAT.FEVER_ATK_MUL);
    return a;
  }

  // 戻り値: Enemies.damageAt の結果配列(撃破座標を含む。game側のblast/vampireで使う)
  function doAttack(verdict) {
    if (char.type === "tackle") return doTackle(verdict);
    if (char.type === "sword") return doSword(verdict);
    if (char.type === "beam") return doBeam(verdict);
    return [];
  }

  // ラット:前方 tackleTiles へ突進。経路上の敵に順次ダメージ。生存敵の手前で停止。
  // 貫通レンズ(pierce): 生存敵に当たっても1体までは通り抜けて先へ進める。
  function doTackle(verdict) {
    const atk = atkTotal(verdict);
    const stats = getStats();
    const tiles = char.tackleTiles || 2;
    let reached = tx;
    let piercedUsed = false;
    const results = [];
    for (let i = 0; i < tiles; i++) {
      const nx = reached + dir;
      if (solid(nx, ty)) break;                    // 壁 → 手前まで
      // ボス占有タイルは大きな壁のように扱う:ダメージを与えて手前で停止(通り抜けない)。
      if (typeof Boss !== "undefined" && Boss.active && Boss.occupies(nx, ty)) {
        const res = Boss.damageAt([{ tx: nx, ty }], atk);
        results.push(...res);
        break;
      }
      const e = (typeof Enemies !== "undefined") ? Enemies.enemyAt(nx, ty) : null;
      if (e) {
        const res = Enemies.damageAt([{ tx: nx, ty }], atk);
        results.push(...res);
        const killed = res.some((r) => r.killed);
        if (killed) { reached = nx; continue; }    // 倒した → 通り抜ける
        if (stats.pierce && !piercedUsed) { piercedUsed = true; reached = nx; continue; } // 貫通(1体まで)
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
    return results;
  }

  // ソードマン:前方1タイル(+その頭上1タイル)へ攻撃。移動なし。
  // 貫通レンズ(pierce): 前方2タイル目(+頭上)まで判定を広げる。
  function doSword(verdict) {
    const atk = atkTotal(verdict);
    const stats = getStats();
    const tiles = [{ tx: tx + dir, ty }, { tx: tx + dir, ty: ty - 1 }];
    if (stats.pierce) tiles.push({ tx: tx + dir * 2, ty }, { tx: tx + dir * 2, ty: ty - 1 });
    const results = dealDamage(tiles, atk);
    attack = { t: 0, dur: 0.2, dir, type: "sword", beamEndTx: 0 };
    return results;
  }

  // ガンナー:前方直線(壁まで)を貫通攻撃。reloadBeats の間は攻撃不可(移動は可)。
  // 貫通レンズ(pierce): ビームは元々直線上の敵全てを貫通しているため追加効果なし。
  function doBeam(verdict) {
    if (curBeat() < reloadUntilBeat) {
      attack = { t: 0, dur: 0.12, dir, type: "beamfail", beamEndTx: tx }; // 不発
      return [];
    }
    const atk = atkTotal(verdict);
    const tiles = [];
    let cx = tx + dir;
    while (!solid(cx, ty) && cx >= 0 && cx < level.w) { tiles.push({ tx: cx, ty }); cx += dir; }
    const results = dealDamage(tiles, atk);
    reloadUntilBeat = curBeat() + (char.reloadBeats || 1);
    attack = { t: 0, dur: 0.16, dir, type: "beam", beamEndTx: cx - dir };
    return results;
  }

  // --- 被弾 ---
  // sourceDir … 攻撃源の方向(+1=右 / -1=左 / 0=同タイル)。ノックバックは逆方向。
  // opts.projectile … 敵の弾によるダメージなら true(忍び装束のprojDefMulを適用)。
  function hurt(dmg, sourceDir, opts) {
    if (hp <= 0) return false;
    if (isInvulnerable()) return false;
    const stats = getStats();
    SFX.hurt();

    let d = dmg;
    if (opts && opts.projectile) d *= stats.projDefMul;
    d *= stats.defMul;

    // シールドが1以上ならこの被弾を消費して無効化(ダメージ0・ノックバックなし)
    if (shield > 0) {
      shield -= 1;
      invulnUntilBeat = curBeat() + CONFIG.COMBAT.INVULN_BEATS;
      hurtCount++;
      return true;
    }

    hp -= d;
    if (hp < 0) hp = 0;

    // ノックバック(knockbackMulで距離を調整。0なら無し)
    let kb = -Math.sign(sourceDir || 0);
    if (kb === 0) kb = -dir;
    const kbTiles = Math.round(CONFIG.COMBAT.KNOCKBACK_TILES * stats.knockbackMul);
    let moved = false;
    for (let i = 0; i < kbTiles; i++) {
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

    // 不死鳥の羽衣(revive): HP0になった時、1ステージ1回だけHP1で復活+シールド1
    if (hp <= 0 && stats.revive && !revivedUsed) {
      revivedUsed = true;
      hp = 1;
      shield = Math.max(shield, 1);
    }
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
        airJumpsUsed = 0; // 着地で空中ジャンプ回数リセット
      }
    } else {
      // idle:描画座標を真実に保つ
      if (!xt.active) x = tx;
      y = ty;
    }

    // 空中ジャンプの足元エフェクト(演出のみ・時間経過で消える)
    if (airPoof) {
      airPoof.t += dt;
      if (airPoof.t >= airPoof.dur) airPoof = null;
    }

    // ブースト中の残像演出(描画専用。直近数フレームぶんの位置を保持しフェード表示する)
    if (isBoosted()) {
      boostTrail.push({ x, y });
      if (boostTrail.length > 5) boostTrail.shift();
    } else if (boostTrail.length) {
      boostTrail.length = 0;
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

    // ブースト中の残像(古い位置ほど薄く・体より先に描く)
    if (boostTrail.length > 1) {
      for (let i = 0; i < boostTrail.length - 1; i++) {
        const tp = boostTrail[i];
        const tcx = (tp.x - cam.x) * TILE + VW / 2;
        const tcy = (tp.y - cam.y) * TILE + VH / 2;
        g.globalAlpha = ((i + 1) / boostTrail.length) * 0.3;
        g.fillStyle = char.color;
        g.beginPath();
        g.arc(tcx, tcy, r * 0.85, 0, Math.PI * 2);
        g.fill();
      }
      g.globalAlpha = 1;
    }

    // 空中ジャンプの足元エフェクト(演出のみ。円が広がって消える。改修バッチ)
    if (airPoof) {
      const pcx = (airPoof.x - cam.x) * TILE + VW / 2;
      const pcy = (airPoof.y - cam.y) * TILE + VH / 2 + r * 0.9;
      const pt = Math.min(1, airPoof.t / airPoof.dur);
      g.globalAlpha = 1 - pt;
      g.strokeStyle = "#ffffff";
      g.lineWidth = 3;
      g.beginPath();
      g.arc(pcx, pcy, TILE * (0.18 + pt * 0.3), 0, Math.PI * 2);
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

    // 体+目:スプライトがあれば画像描画、無ければ従来の円+目にフォールバック。
    // キーは attack.dur>0(攻撃モーション中)で idle/attack を切り替える。
    const sprKey = "player_" + charId + "_" + (attack.dur > 0 ? "attack" : "idle");
    const sprEntry = (typeof Sprites !== "undefined") ? Sprites.getEntry(sprKey) : null;

    if (sprEntry) {
      // --- スプライト描画 ---
      const iw = sprEntry.canvas.width, ih = sprEntry.canvas.height;
      const drawH = CONFIG.SPRITE.DRAW_TILES * TILE; // 描画高さ(タイル単位×TILE)
      const anchorX = cx + thrust * 0.3;             // タックルの突き分をスプライトにも反映
      const footScreenY = cy + CONFIG.SPRITE.FOOT_LIFT * TILE; // 足元(影の位置に揃える。FOOT_LIFTで微調整)

      // per-spriteアンカー表があればそれを使う(攻撃画像の砂埃で不透明boxが破綻するため)。
      // 無ければ不透明box基準にフォールバック(敵/ボス等)。
      const anc = (CONFIG.SPRITE.ANCHORS && CONFIG.SPRITE.ANCHORS[sprKey]) || null;
      let scale, srcCx, srcFootY;
      if (anc) {
        scale = drawH / (anc.h * ih);   // 身長hで割ることで画面上の見た目サイズを一定に保つ
        srcCx = anc.cx * iw;
        srcFootY = anc.foot * ih;
      } else {
        const box = sprEntry.box;
        const boxH = box.maxy - box.miny + 1;
        scale = drawH / boxH;
        srcCx = (box.minx + box.maxx + 1) / 2;
        srcFootY = box.maxy + 1;
      }

      g.imageSmoothingEnabled = true;
      g.translate(anchorX, footScreenY);
      if (dir < 0) g.scale(-1, 1); // 左向きは水平反転(元画像は右向き)
      g.scale(scale, scale);
      // 画像点(srcCx, srcFootY)を原点(足元)へ合わせて全体を描く
      g.drawImage(sprEntry.canvas, -srcCx, -srcFootY);
    } else {
      // --- フォールバック:従来の円+目(スプライト未ロード/失敗時) ---
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
    }
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
    setCombatContext, heal, addShield, setBoost, isBoosted, boostRemaining,
    get hp() { return hp; },
    get maxHp() { return maxHp; },
    get shield() { return shield; },
    get charId() { return charId; },
    get charName() { return char ? char.name : ""; },
    get hurtCount() { return hurtCount; },
    isDead() { return hp <= 0; },
  };
})();
