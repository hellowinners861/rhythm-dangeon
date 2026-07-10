// sprites.js … スプライトローダー(グローバル Sprites)
// assets/ のグリーンバックPNGを読み込み時にクロマキー(緑背景除去)+生成アーティファクト
// (右下の「✦」マーク)除去し、処理済みcanvasを保持する。描画のみ。拍・判定には一切触れない。
//
// 【処理はロード時1回だけ】getImageData→ピクセル走査→putImageData を1枚につき1回行い、
// 以後は処理済みcanvasを Player.draw 等で使い回す(毎フレーム処理しない)。
// 【http配信必須】getImageData は file:// ではtaintでき失敗する。検証は http.server 経由で行う。

const Sprites = (() => {
  // マニフェスト(キー→パス)。値は「文字列パス」または「{path, key}」(keyはper-imageクロマキー調整)、
  // または「{path, raw:true, resize}」(地形タイル用。クロマキー等をスキップし✦だけパッチ修復する)。
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
    // 走りポーズ(横移動中に表示)+敵3種
    player_rat_run:     "assets/player_rat_run.png",
    player_gun_run:     "assets/player_gun_run.png",
    enemy_bat_gold:     "assets/enemy_bat_gold.png",
    enemy_knight:       "assets/enemy_knight.png",
    enemy_knight_black: "assets/enemy_knight_black.png",
    // 章別の地形テクスチャ(rawモード。全面塗り・透過なしのシームレス画像なのでクロマキーは不要)
    tile_forest: { path: "assets/tile_forest.png", raw: true, resize: 256 },
    tile_city:   { path: "assets/tile_city.png",   raw: true, resize: 256 },
    tile_castle: { path: "assets/tile_castle.png", raw: true, resize: 256 },
    // ソードマン走り+ガンナー敵
    player_sword_run: "assets/player_sword_run.png",
    enemy_gunner:     "assets/enemy_gunner.png",
    // 多層スクロール背景(視差)。原寸1376×768のまま保持(resizeは実質そのまま)。
    // 背景3枚は ✦ が中心≈(0.91, 0.845) にあるためパッチ位置を個別指定する。
    //   bg_moon : 全章共通の最遠層(月夜の空)。不透明のまま raw で使う。
    //   bg_forest: 1章の中景(森のシルエット)。skyKeyで紺空を透過に抜いて月を見せる。
    //   bg_city : 2章の中景(機械都市)。不透明のまま raw で使う。
    bg_moon:   { path: "assets/bg_moon.png",   raw: true,    resize: { w: 1376, h: 768 }, patch: { dst: [0.86, 0.78, 0.96, 0.92], srcX: 0.66 } },
    bg_forest: { path: "assets/bg_forest.png", skyKey: true, resize: { w: 1376, h: 768 }, patch: { dst: [0.86, 0.78, 0.96, 0.92], srcX: 0.66 } },
    bg_city:   { path: "assets/bg_city.png",   raw: true,    resize: { w: 1376, h: 768 }, patch: { dst: [0.86, 0.78, 0.96, 0.92], srcX: 0.66 } },
    //   bg_castle: 3章の中景(嵐の魔王城)。渦雲の空ごと1枚で使うため不透明のまま raw で使う。
    bg_castle: { path: "assets/bg_castle.png", raw: true,    resize: { w: 1376, h: 768 }, patch: { dst: [0.86, 0.78, 0.96, 0.92], srcX: 0.66 } },
    // ゴースト敵(グリーンバック・✦あり。既定則 "enemy_"+kind で自動適用される)
    enemy_ghost: "assets/enemy_ghost.png",
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

  // ✦パッチ修復のデフォルト箱(タイル用)。patch省略時に使う(画像比率)。
  //   dst=[x0,y0,x1,y1](✦を隠す上書き先の矩形比率)、srcX=コピー元の左端X比率(yと大きさはdstと共通)。
  const PATCH_DEFAULT = { dst: [0.82, 0.82, 0.94, 0.94], srcX: 0.62 };

  // ✦の生成アーティファクトを「同画像の別領域を自己コピーして上書き」してパッチ修復する。
  // patch省略時はタイル用デフォルト(dst x∈[0.82,0.94] y∈[0.82,0.94], srcX 0.62)。
  function patchStar(ctx, cv, w, h, patch) {
    const p = patch || PATCH_DEFAULT;
    const [x0, y0, x1, y1] = p.dst;
    const boxW = (x1 - x0) * w, boxH = (y1 - y0) * h;
    const dstX = x0 * w, dstY = y0 * h;
    const srcX = p.srcX * w;
    // 同じ大きさの領域(srcX起点・同じy)を dst へ自己コピーして上書きする
    ctx.drawImage(cv, srcX, dstY, boxW, boxH, dstX, dstY, boxW, boxH);
  }

  // resize指定に従って縮小canvasを返す。resize省略時は元canvasをそのまま返す。
  // resizeは数値(正方形)または {w,h}(非正方形)を受け付ける(背景の原寸保持は {w,h} で指定)。
  function resizeCanvas(cv, w, h, resize) {
    if (!resize) return cv;
    const rw = (typeof resize === "object") ? resize.w : resize;
    const rh = (typeof resize === "object") ? resize.h : resize;
    const rc = document.createElement("canvas");
    rc.width = rw; rc.height = rh;
    const rctx = rc.getContext("2d");
    rctx.drawImage(cv, 0, 0, w, h, 0, 0, rw, rh);
    return rc;
  }

  // 「rawタイル/背景」用の読み込み処理。全面塗り・透過なしのシームレス画像のため、
  // クロマキー・スピル抑制・✦の透過消去は一切行わない(行うと絵が破壊される)。
  // 代わりに✦の生成アーティファクトを自己コピーでパッチ修復のみ行い、最後に resize 指定へ縮小して保持する。
  async function loadOneRaw(key, path, resize, patch) {
    const img = new Image();
    img.src = path;
    await img.decode();

    const w = img.naturalWidth, h = img.naturalHeight;
    const cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    const ctx = cv.getContext("2d");
    ctx.drawImage(img, 0, 0);

    // --- ✦パッチ修復(patch比率。省略時はタイル用デフォルト) ---
    patchStar(ctx, cv, w, h, patch);

    // --- resize:処理後を指定サイズへ縮小(背景は原寸{w,h}指定なので実質そのまま) ---
    const outCv = resizeCanvas(cv, w, h, resize);

    // rawは全面が不透明のため box は canvas 全体としておく(box基準フォールバックとの整合)。
    store[key] = { canvas: outCv, box: { minx: 0, miny: 0, maxx: outCv.width - 1, maxy: outCv.height - 1 } };
  }

  // 「skyKey背景」用の読み込み処理(bg_forest用)。rawと同様に✦をパッチ修復した後、
  // 空(紺)を透過に抜いて奥の月レイヤーを見せる。getImageData処理が要るので resize 前に行う。
  //   透過条件(ディレクター実測): y < 0.68H かつ b>25 かつ b>g*1.15 かつ b>r*1.5 の画素を透過。
  //   y≥0.68H(地面の黒帯)は全て残す(木々のシルエットを保持)。
  async function loadOneSkyKey(key, path, resize, patch) {
    const img = new Image();
    img.src = path;
    await img.decode();

    const w = img.naturalWidth, h = img.naturalHeight;
    const cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    const ctx = cv.getContext("2d");
    ctx.drawImage(img, 0, 0);

    // --- ✦パッチ修復(空抜きの前に処理する) ---
    patchStar(ctx, cv, w, h, patch);

    // --- 空抜き:上部(y<0.68H)の紺色画素を透過。地面帯(y≥0.68H)は全て残す ---
    const imageData = ctx.getImageData(0, 0, w, h); // http配信下でのみ動く(file://はtaint)
    const d = imageData.data;
    const yGround = 0.68 * h;
    for (let y = 0; y < h; y++) {
      if (y >= yGround) continue; // 地面の黒帯はそのまま(シルエット保持)
      const rowOff = y * w * 4;
      for (let x = 0; x < w; x++) {
        const i = rowOff + x * 4;
        const r = d[i], gg = d[i + 1], b = d[i + 2];
        if (b > 25 && b > gg * 1.15 && b > r * 1.5) d[i + 3] = 0;
      }
    }
    ctx.putImageData(imageData, 0, 0);

    // --- resize(getImageData処理後に縮小) ---
    const outCv = resizeCanvas(cv, w, h, resize);
    store[key] = { canvas: outCv, box: { minx: 0, miny: 0, maxx: outCv.width - 1, maxy: outCv.height - 1 } };
  }

  // 全画像のロード+処理を開始(async。game側の起動で呼ぶ)。
  // 1枚でも失敗しても他は続行(try/catch、失敗はconsole.warnのみ)。
  async function load() {
    const jobs = Object.keys(MANIFEST).map(async (key) => {
      try {
        const entry = MANIFEST[key];
        const isObj = typeof entry === "object" && entry !== null;
        const path = isObj ? entry.path : entry;
        if (isObj && entry.skyKey) {
          await loadOneSkyKey(key, path, entry.resize, entry.patch);
          return;
        }
        if (isObj && entry.raw) {
          await loadOneRaw(key, path, entry.resize, entry.patch);
          return;
        }
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
