// sprites.js … スプライトローダー(グローバル Sprites)
// assets/ のグリーンバックPNGを読み込み時にクロマキー(緑背景除去)+生成アーティファクト
// (右下の「✦」マーク)除去し、処理済みcanvasを保持する。描画のみ。拍・判定には一切触れない。
//
// 【処理はロード時1回だけ】getImageData→ピクセル走査→putImageData を1枚につき1回行い、
// 以後は処理済みcanvasを Player.draw 等で使い回す(毎フレーム処理しない)。
// 【http配信必須】getImageData は file:// ではtaintでき失敗する。検証は http.server 経由で行う。

const Sprites = (() => {
  // マニフェスト(キー→パス)。値は「文字列パス」または「{path, key}」(keyはper-imageクロマキー調整)。
  // 敵/ボス用の一部画像は背景緑と体色緑が近く、デフォルトの閾値では体が消えるため個別調整する。
  const MANIFEST = {
    player_rat_idle:     "assets/player_rat_idle.png",
    player_rat_attack:   "assets/player_rat_attack.png",
    player_sword_idle:   "assets/player_sword_idle.png",
    player_sword_attack: "assets/player_sword_attack.png",
    player_gun_idle:     "assets/player_gun_idle.png",
    player_gun_attack:   "assets/player_gun_attack.png",
    // 敵3種+ボス1種(ディレクター実測: 背景緑=(12,242,7)、スライム体=(31,109,37))
    enemy_slime:        { path: "assets/enemy_slime.png", key: { gMin: 190, ratio: 2.2, spill: false } },
    enemy_slime_red:    "assets/enemy_slime_red.png",
    enemy_bat:          "assets/enemy_bat.png",
    boss_silencer_idle: "assets/boss_silencer_idle.png",
  };

  // per-imageクロマキーのデフォルト値(省略時)
  const KEY_DEFAULT = { gMin: 90, ratio: 1.2, spill: true };

  // 処理済みエントリ: key → { canvas, box:{minx,miny,maxx,maxy} }
  const store = {};

  // 1枚を読み込み→クロマキー+✦除去→バウンディングボックス算出して store へ格納する。
  // 失敗しても throw せず呼び出し側(load)で握りつぶす(1枚失敗でも他は続行)。
  // keyOpt: { gMin, ratio, spill }(省略時 KEY_DEFAULT)。
  async function loadOne(key, path, keyOpt) {
    const opt = Object.assign({}, KEY_DEFAULT, keyOpt || {});
    const img = new Image();
    img.src = path;
    await img.decode(); // デコード完了を待つ(onloadより確実)

    const w = img.naturalWidth, h = img.naturalHeight;
    const cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    const ctx = cv.getContext("2d");
    ctx.drawImage(img, 0, 0);

    const imageData = ctx.getImageData(0, 0, w, h); // http配信下でのみ動く(file://はtaint)
    const d = imageData.data;

    // --- 1) 緑背景を透過 + 2) 緑フチのスピル抑制(per-imageパラメータ) ---
    for (let i = 0; i < d.length; i += 4) {
      let r = d[i], g = d[i + 1], b = d[i + 2];
      // 1) 緑背景を透過(緑優勢)
      if (g > opt.gMin && g > r * opt.ratio && g > b * opt.ratio) {
        d[i + 3] = 0;
        continue;
      }
      // 2) 緑フチのスピル抑制(残す画素で緑が突出していたら緑を下げる)。
      //    spill:false のときは行わない(体色自体の緑が破壊される画像向け)。
      if (opt.spill) {
        const avg = (r + b) / 2;
        if (g > avg * 1.15) {
          d[i + 1] = Math.round(avg * 1.15);
        }
      }
    }

    // --- 3) ✦除去:箱 x∈[0.83W,0.93W], y∈[0.83H,0.93H] 内の淡い画素(r+g+b>430)のみ透過 ---
    const x0 = Math.floor(0.83 * w), x1 = Math.floor(0.93 * w);
    const y0 = Math.floor(0.83 * h), y1 = Math.floor(0.93 * h);
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * w + x) * 4;
        if (d[i + 3] !== 0 && (d[i] + d[i + 1] + d[i + 2]) > 430) {
          d[i + 3] = 0;
        }
      }
    }

    ctx.putImageData(imageData, 0, 0);

    // --- 処理後の不透明ピクセルのバウンディングボックス(足元アンカー算出用) ---
    let minx = w, miny = h, maxx = -1, maxy = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (d[(y * w + x) * 4 + 3] !== 0) {
          if (x < minx) minx = x;
          if (x > maxx) maxx = x;
          if (y < miny) miny = y;
          if (y > maxy) maxy = y;
        }
      }
    }
    // 全画素透過の異常時はcanvas全体をboxとしておく(0除算回避)
    if (maxx < minx) { minx = 0; miny = 0; maxx = w - 1; maxy = h - 1; }

    store[key] = { canvas: cv, box: { minx, miny, maxx, maxy } };
  }

  // 全画像のロード+処理を開始(async。game側の起動で呼ぶ)。
  // 1枚でも失敗しても他は続行(try/catch、失敗はconsole.warnのみ)。
  async function load() {
    const jobs = Object.keys(MANIFEST).map(async (key) => {
      try {
        const entry = MANIFEST[key];
        const isObj = typeof entry === "object" && entry !== null;
        const path = isObj ? entry.path : entry;
        const keyOpt = isObj ? entry.key : null;
        await loadOne(key, path, keyOpt);
      } catch (e) {
        console.warn("[Sprites] 読み込み/処理に失敗:", key, e);
      }
    });
    await Promise.all(jobs);
  }

  // 処理済みエントリ全体({canvas, box})を返す。未ロード/失敗時は null。
  function getEntry(key) {
    return store[key] || null;
  }

  // 処理済みcanvasを返す。未ロード/失敗時は null(呼び出し側は図形描画にフォールバック)。
  function get(key) {
    return store[key] ? store[key].canvas : null;
  }

  // そのキーが利用可能か。
  function ready(key) {
    return !!store[key];
  }

  // 読み込み済み枚数(デバッグ用)。
  function count() {
    return Object.keys(store).length;
  }

  return { load, get, getEntry, ready, count };
})();
