// levelgen.js … チャンクテンプレート+自動生成+ゴール距離算出
// DESIGN §6/§4。Step3: 固定テストレベルを廃し、チャンクのシード接続で毎回生成する。
//
// タイル定義:
//   '#' = 地形ブロック(壁・床)      … 唯一の衝突タイル(solidAt)
//   '.' = 空
//   'S' = スタート位置(プレイヤー初期タイル。中身は空扱い)
//   'G' = ゴール(旗)
//   'E' = 敵スポーン候補   … 空タイル扱い。生成時 spawns に収集(Step4で実体化)
//   'C' = コインスポーン候補 … 空タイル扱い。spawns に収集
//   'I' = アイテムスポーン候補 … 空タイル扱い。spawns に収集
// レベルは「行末までの文字列」を上から順に並べた配列で表す。
//
// 【接続保証】全テンプレートは 16×11。左端(col0)・右端(col15)の列は
//   BORDER_GROUND_Y(=8)行に床'#'、その上2タイル(row6,7)が空、row9/10も床。
//   これでどの順に繋いでも境界を row7 立ち(足元 row8)で通過できる。

const LevelGen = (() => {
  const CW = 16; // チャンク幅(テンプレートの実寸。CONFIG.STAGE.CHUNK_W と一致させる)

  // 決定的PRNG(mulberry32)。同じseedなら同じ数列を返す → 同一レベルを再現できる。
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // スタートチャンク(平坦・'S'あり)。中間の入口と繋がるよう境界は規格通り。
  const START = [
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "..S........C....",
    "################",
    "################",
    "################",
  ];

  // ゴールチャンク(平坦・'G'あり)。
  const GOAL = [
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "....C........G..",
    "################",
    "################",
    "################",
  ];

  // 中間チャンク(10個以上)。段差1/2・谷・ジャンプ壁・低天井・広場・浮き足場などを分散。
  const MIDDLE = [
    // M1 平坦(コイン)
    [
      "................",
      "................",
      "................",
      "................",
      "................",
      "................",
      "................",
      "....C.....C.....",
      "################",
      "################",
      "################",
    ],
    // M2 1段の段差(上に敵)
    [
      "................",
      "................",
      "................",
      "................",
      "................",
      "................",
      ".........E......",
      "......#######...",
      "################",
      "################",
      "################",
    ],
    // M3 2段のジャンプ壁(上にコイン)
    [
      "................",
      "................",
      "................",
      "................",
      "................",
      ".........C......",
      ".......###......",
      ".......###......",
      "################",
      "################",
      "################",
    ],
    // M4 谷(落ちて登る・コイン)
    [
      "................",
      "................",
      "................",
      "................",
      "................",
      "................",
      "................",
      ".....C....C.....",
      "#####....#######",
      "#####....#######",
      "################",
    ],
    // M5 丘(2段の高台・上に敵とアイテム)
    [
      "................",
      "................",
      "................",
      "................",
      "................",
      "......E...I.....",
      "......####......",
      "....########....",
      "################",
      "################",
      "################",
    ],
    // M6 低天井の通路(アイテム/敵/コイン)
    [
      "................",
      "................",
      "................",
      "................",
      "................",
      "....########....",
      "................",
      ".....I..E..C....",
      "################",
      "################",
      "################",
    ],
    // M7 浮き足場(コインは足場の上・敵は地上)
    [
      "................",
      "................",
      "................",
      "................",
      "................",
      "......C..C......",
      "....##....##....",
      ".......E........",
      "################",
      "################",
      "################",
    ],
    // M8 広い谷+中央の踏み石(アイテム)
    [
      "................",
      "................",
      "................",
      "................",
      "................",
      ".......I........",
      ".......##.......",
      "....C.......C...",
      "###.........####",
      "###.........####",
      "################",
    ],
    // M9 壁と隙間(2段壁+コイン)
    [
      "................",
      "................",
      "................",
      "................",
      ".....CC.........",
      "................",
      ".....##.........",
      ".....##...#.....",
      "################",
      "################",
      "################",
    ],
    // M10 低天井のあと谷(コイン)
    [
      "................",
      "................",
      "................",
      "................",
      "..######........",
      "................",
      "................",
      ".........C.C....",
      "########...#####",
      "########...#####",
      "################",
    ],
    // M11 くぼ地(敵とコイン)
    [
      "................",
      "................",
      "................",
      "................",
      "................",
      "................",
      "................",
      "..E........C....",
      "####......######",
      "################",
      "################",
    ],
    // M12 複合(1段上り→2段ジャンプ壁・上にコイン)
    [
      "................",
      "................",
      "................",
      "................",
      "................",
      "............C...",
      "..........##....",
      "....###...##....",
      "################",
      "################",
      "################",
    ],
    // M13 高低差の大きい階段(1段ずつの上り下り。頂上と各段にコイン、麓に敵)
    [
      "................",
      "................",
      "................",
      "................",
      ".......C........",
      ".....C.##.......",
      ".....######C....",
      ".E.##########...",
      "################",
      "################",
      "################",
    ],
    // M14 天井から吊るされた足場列(低い天井の下に浮き足場が並ぶ。乗るとコイン)
    [
      "................",
      "................",
      "................",
      "................",
      "....########....",
      "....C..C..C..C..",
      "....#..#..#..#..",
      "................",
      "################",
      "################",
      "################",
    ],
    // M15 コインの弧(緩やかな弧を描くコイン列。地上ルートでも一部回収できる)
    [
      "................",
      "................",
      "................",
      "................",
      "................",
      ".....CCCCCC.....",
      "....C......C....",
      "...C........C...",
      "################",
      "################",
      "################",
    ],
    // M16 E/Iを絡めた小部屋(低い天井の小部屋に敵とアイテム)
    [
      "................",
      "................",
      "................",
      "......####......",
      "................",
      ".......E.I......",
      "......####......",
      "................",
      "################",
      "################",
      "################",
    ],
    // M17 二段床(上ルート=橋の上にコイン・下ルート=地上に敵)
    [
      "................",
      "................",
      "................",
      "................",
      "................",
      "......C.C.......",
      ".....######.....",
      ".......E........",
      "################",
      "################",
      "################",
    ],
    // M18 深い谷+アイテム(落ちた先に敵とアイテム。前後にコイン)
    [
      "................",
      "................",
      "................",
      "................",
      "................",
      "................",
      "................",
      "....C........C..",
      "#####......#####",
      "#####..E.I.#####",
      "################",
    ],
  ];

  // ボスアリーナチャンク(幅24×高さ11・平坦・DESIGN §10・Step8)。
  // 右端(col23)に高さ3(row5,6,7)の壁。左端は境界規格どおり開いていて、
  //   プレイヤーが進入した後に game.js が左壁(col0の高さ3)をせり上がらせて閉じる(見た目+トラップ)。
  // ground は row8,9,10。'G' は置かない(ボス撃破=クリア)。
  const ARENA = [
    "........................",
    "........................",
    "........................",
    "........................",
    "........................",
    ".......................#",
    ".......................#",
    ".......................#",
    "########################",
    "########################",
    "########################",
  ];

  // ===== 縦方向拡張(2Dグリッド生成)用のテンプレート群。DESIGN §6「縦方向拡張」 =====
  //
  // 【縦連絡路の契約(BORDER_GROUND_Y と同格の規格)】どのテンプレート同士を縦に繋いでも
  // 整合するよう、チャンク境界の縦通行は固定列で行う:
  //   ・上り通路(登り):列3〜4  … exit=U の天井開口 / enter=U の床開口 がともに列3〜4で一致
  //   ・下り穴(落下)  :列11〜12 … exit=D の床穴 / enter=D の天井開口 がともに列11〜12で一致
  // 登りはジグザグ足場(段差2・横2ずらし)で1拍1アクションずつ上がる(同一列真上の足場は
  // ジャンプ頭打ちになるため必ず横にずらす)。プレイヤー実測(player.js): 接地ジャンプ+2、
  // 空中ジャンプ+2(計+4)、空中横移動2タイル。足場の縦間隔は2以下、横間隔は1〜2。
  //
  // enter(直前の移動方向) × exit(次の移動方向) の組合せでテンプレートを選ぶ:
  //   L→R … 純横断(既存 MIDDLE を流用) / L→U / L→D / U→R / U→U / D→R / D→D
  //   (U→D と D→U は逆行=セル再訪のため生成側で禁止)
  // 登り足場の規格(exit=U / enter=U のクライム部): plat A=row6 列3-4 / plat B=row4 列5-6 /
  //   plat C=row1 列3-4(上端)。row7地上→col5で踏み切り→A→B→Cと登り、Cの上(列3-4)から
  //   上のチャンクの床開口(列3-4)へ抜ける。上のチャンク(enter=U)は列3-4の床穴+着地余地を持つ。

  // L→U(左入口・上へ抜ける)。地上から列3-4の天井開口までジグザグで登る。
  const V_LU = [
    "....C...........",
    "...##...........",  // plat C(上端。列3-4)
    "................",
    "......C.........",
    ".....##.........",  // plat B(列5-6)
    "................",
    "...##...........",  // plat A(列3-4)
    "..........E..I..",  // 敵(列10)+アイテム(列13)
    "################",
    "################",
    "################",
  ];

  // L→D(左入口・下へ落ちる)。地上を右へ進み列11-12の床穴から落下する。縁にコインで誘導。
  const V_LD = [
    "................",
    "................",
    "................",
    "................",
    "...........C....",  // 落下経路のコイン(列11)
    "................",
    "................",
    ".....E....C.....",  // 敵(列5)+穴の縁のコイン(列10)
    "###########..###",
    "###########..###",
    "###########..###",
  ];

  // U→R(下から入り・右へ抜ける)。列3-4の床穴から登ってきたプレイヤーが地上へ出て右へ進む。
  const V_UR = [
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "......C.........",  // 着地脇のコイン
    "..........E..C..",  // 敵(列10)+コイン(列13)
    "###..###########",  // 床穴(列3-4)
    "###..###########",
    "###..###########",
  ];

  // U→U(下から入り・上へ抜ける)。列3-4を貫く登りシャフト(床穴+ジグザグ+天井開口)。
  const V_UU = [
    "....C...........",
    "...##...........",  // plat C(上端。列3-4)
    "................",
    "......C.........",
    ".....##.........",  // plat B(列5-6)
    "................",
    "...##...........",  // plat A(列3-4)
    "..........E..I..",  // 敵(列10)+アイテム(列13)
    "###..###########",  // 床穴(列3-4)
    "###..###########",
    "###..###########",
  ];

  // D→R(上から落ちて入り・右へ抜ける)。列11-12の天井開口から落下し地上へ着地、右へ進む。
  const V_DR = [
    "................",
    "................",
    "................",
    "................",
    "...........C....",  // 落下経路のコイン(列11)
    "................",
    "................",
    ".....E.......C..",  // 敵(列5)+右へ誘導のコイン(列13)
    "################",
    "################",
    "################",
  ];

  // D→D(上から落ちて入り・下へ落ちる)。列11-12を貫く落下シャフト(天井開口〜床穴が素通し)。
  const V_DD = [
    "................",
    "................",
    "............C...",  // シャフト内のコイン(列12)
    "................",
    "................",
    "...........C....",  // シャフト内のコイン(列11)
    "................",
    "................",
    "###########..###",
    "###########..###",
    "###########..###",
  ];

  // パス外セル用の全埋めチャンク(未使用の左右/上下境界を自動的に塞ぐ)。
  const V_SOLID = [
    "################",
    "################",
    "################",
    "################",
    "################",
    "################",
    "################",
    "################",
    "################",
    "################",
    "################",
  ];

  // 縦移動チャンクは、上り/下りそれぞれ5種類以上の地形差が出るように安全な範囲だけ
  // E/C/I や小足場を差し替えたバリエーションを持たせる(縦連絡路の固定列は変えない)。
  function variant(rows, edits) {
    const a = rows.slice();
    for (const e of edits) a[e[0]] = e[1];
    return a;
  }
  const UP_VARIANTS = [
    V_LU,
    variant(V_LU, [[0, "...CC..........."], [3, "......I........."], [7, ".............E.."]]),
    variant(V_LU, [[2, "........C......."], [5, "..C............."], [7, "..........I..E.."]]),
    variant(V_LU, [[0, "....I..........."], [3, "......C....C...."], [7, "........E.....C."]]),
    variant(V_LU, [[2, "..C............."], [5, ".......C........"], [7, "..........E..C.."]]),
  ];
  const UP_THROUGH_VARIANTS = [
    V_UU,
    variant(V_UU, [[0, "...CC..........."], [3, "......I........."], [7, ".............E.."]]),
    variant(V_UU, [[2, "........C......."], [5, "..C............."], [7, "..........I..E.."]]),
    variant(V_UU, [[0, "....I..........."], [3, "......C....C...."], [7, "........E.....C."]]),
    variant(V_UU, [[2, "..C............."], [5, ".......C........"], [7, "..........E..C.."]]),
  ];
  const DOWN_VARIANTS = [
    V_LD,
    variant(V_LD, [[4, "...........I...."], [7, "..C..E....C....."]]),
    variant(V_LD, [[3, ".............C.."], [7, ".....I....C..E.."]]),
    variant(V_LD, [[4, "...........C...."], [6, "..C............."], [7, ".....E.......I.."]]),
    variant(V_LD, [[2, "............C..."], [7, "..I..E....C....."]]),
  ];
  const DOWN_THROUGH_VARIANTS = [
    V_DD,
    variant(V_DD, [[2, "............I..."], [5, "...........C.C.."]]),
    variant(V_DD, [[1, "............C..."], [7, "..C............."]]),
    variant(V_DD, [[3, "...........I...."], [5, "...........C...."]]),
    variant(V_DD, [[2, "............C..."], [6, ".............C.."]]),
  ];

  // enter+exit の2文字キー → テンプレート候補(L→R/R→L は生成側で MIDDLE を使う)。
  const VTEMPLATES = {
    LU: UP_VARIANTS, UU: UP_THROUGH_VARIANTS, RU: UP_VARIANTS, DU: UP_THROUGH_VARIANTS,
    LD: DOWN_VARIANTS, DD: DOWN_THROUGH_VARIANTS, RD: DOWN_VARIANTS, UD: DOWN_THROUGH_VARIANTS,
    UR: V_UR, DR: V_DR, UL: V_UR, DL: V_DR,
  };

  // 文字列配列 → レベル構造体。
  // 返り値: { w, h, tiles(tiles[y][x]=char), startX, startY, goalX, goalY }
  function parse(rows) {
    const h = rows.length;
    const w = rows.reduce((m, r) => Math.max(m, r.length), 0);
    const tiles = [];
    let startX = 1, startY = 1, goalX = w - 2, goalY = 1;
    for (let y = 0; y < h; y++) {
      const line = rows[y];
      const row = [];
      for (let x = 0; x < w; x++) {
        const ch = line[x] || ".";
        if (ch === "S") { startX = x; startY = y; }
        else if (ch === "G") { goalX = x; goalY = y; }
        row.push(ch);
      }
      tiles.push(row);
    }
    return { w, h, tiles, startX, startY, goalX, goalY };
  }

  // タイルが壁(衝突する地形)か。
  // 範囲外の扱い: 横方向・下方向は壁 / 上方向(y<0)は空。
  function solidAt(level, tx, ty) {
    if (ty < 0) return false;              // 天井の上は空(高く飛べる)
    if (ty >= level.h) return true;        // 最下段より下は床(落下死なし)
    if (tx < 0 || tx >= level.w) return true; // 左右の外は壁
    return level.tiles[ty][tx] === "#";
  }

  // 前チャンクと同じテンプレを避けつつ、シード乱数で中間テンプレを1つ選ぶ。
  function pickMiddle(rand, lastIdx) {
    let idx = Math.floor(rand() * MIDDLE.length);
    if (idx >= MIDDLE.length) idx = MIDDLE.length - 1; // rand()が1未満の保険
    if (idx === lastIdx && MIDDLE.length > 1) {
      idx = (idx + 1 + Math.floor(rand() * (MIDDLE.length - 1))) % MIDDLE.length;
    }
    return idx;
  }

  // 複数チャンク(11行×16列)を横に連結して1つの行配列にする。
  function concatChunks(chunks) {
    const h = CONFIG.STAGE.CHUNK_H;
    const rows = [];
    for (let y = 0; y < h; y++) {
      let line = "";
      for (const c of chunks) line += c[y];
      rows.push(line);
    }
    return rows;
  }

  // ===== 縦方向拡張(2Dグリッド生成)。DESIGN §6「縦方向拡張」 =====

  // グリッド行数を ROW_WEIGHTS で抽選(1..len)。seed 由来の専用 rng を使い、本体ストリームを汚さない。
  function pickRows(sd, weights) {
    const r = rng((sd ^ 0x5f356495) >>> 0);
    const total = weights.reduce((a, b) => a + b, 0);
    let t = r() * total;
    for (let i = 0; i < weights.length; i++) {
      t -= weights[i];
      if (t < 0) return i + 1;
    }
    return weights.length;
  }

  // 2Dグリッド生成。スタート→ゴールの一本道パスをランダムウォーク(右/左/上/下)で作り、
  // パス上のセルに enter/exit 方向に応じたテンプレートを、パス外セルに V_SOLID を置く。
  //   sd: この生成に使うseed(rerollで変換される)/ R: グリッド行数 / N: パスセル総数(=従来チャンク数)
  //   densityMul: E/C/I 採用率係数 / goalDist: レベルに記録する参考値
  // 返り値: parse済みレベル(BFS未検証)。矛盾時は null(呼び出し側でreroll)。
  function generateVertical(sd, R, N, densityMul, goalDist) {
    const S = CONFIG.STAGE;
    const V = S.VERTICAL || {};
    const vertRate = (typeof V.VERT_RATE === "number") ? V.VERT_RATE : 0.35;
    const walk = rng((sd ^ 0xa53c9b6d) >>> 0); // パス・テンプレート選択用の乱数

    // --- ランダムウォークでパスを作る(右R/左L/上U/下D。即反転・再訪は禁止) ---
    let gr = Math.min(R - 1, Math.floor(walk() * R)); // スタート行(列0)
    let gc = 0;
    const cells = [{ gr, gc, inMove: null, outMove: null }];
    const visited = new Set([gr + "," + gc]);
    let lastMove = null;
    const moves = N - 1;
    for (let i = 0; i < moves; i++) {
      let mv;
      // 最初だけは必ず右(STARTから出る向きを固定)。最後は左ゴールも許可する。
      if (i === 0) {
        mv = "R";
      } else {
        const candV = [];
        if (lastMove !== "D" && gr - 1 >= 0 && !visited.has((gr - 1) + "," + gc)) candV.push("U");
        if (lastMove !== "U" && gr + 1 <= R - 1 && !visited.has((gr + 1) + "," + gc)) candV.push("D");
        const candH = [];
        if (lastMove !== "L" && !visited.has(gr + "," + (gc + 1))) candH.push("R");
        if (lastMove !== "R" && gc - 1 >= 0 && !visited.has(gr + "," + (gc - 1))) candH.push("L");
        if (candV.length > 0 && walk() < vertRate) {
          mv = candV[Math.min(candV.length - 1, Math.floor(walk() * candV.length))];
        } else if (candH.length > 0) {
          // 基本は右へ伸ばすが、ときどき左にも進み、ゴールが右端とは限らない形を作る。
          const leftBias = (typeof V.LEFT_RATE === "number") ? V.LEFT_RATE : 0.22;
          mv = (candH.includes("L") && walk() < leftBias) ? "L" : candH[0];
        } else if (candV.length > 0) {
          mv = candV[Math.min(candV.length - 1, Math.floor(walk() * candV.length))];
        } else {
          return null;
        }
      }
      if (mv === "U") gr -= 1;
      else if (mv === "D") gr += 1;
      else if (mv === "L") gc -= 1;
      else gc += 1;
      const key = gr + "," + gc;
      if (visited.has(key)) return null; // 万一の再訪(通常起きない)→ reroll
      visited.add(key);
      cells[cells.length - 1].outMove = mv;
      cells.push({ gr, gc, inMove: mv, outMove: null });
      lastMove = mv;
    }

    // --- グリッド範囲(未使用の行は詰める) ---
    let minR = Infinity, maxR = -Infinity, minC = Infinity, maxC = -Infinity;
    for (const c of cells) {
      if (c.gr < minR) minR = c.gr;
      if (c.gr > maxR) maxR = c.gr;
      if (c.gc < minC) minC = c.gc;
      if (c.gc > maxC) maxC = c.gc;
    }
    const usedR = maxR - minR + 1;
    const C = maxC - minC + 1;

    // --- テンプレート格子(デフォルト=全埋め)にパスセルのテンプレを配置 ---
    const gridT = [];
    for (let r = 0; r < usedR; r++) gridT.push(new Array(C).fill(V_SOLID));
    let vertMoves = 0, leftMoves = 0;
    for (let idx = 0; idx < cells.length; idx++) {
      const c = cells[idx];
      if (c.inMove === "U" || c.inMove === "D") vertMoves++;
      if (c.inMove === "L") leftMoves++;
      gridT[c.gr - minR][c.gc - minC] = pickCellTemplate(idx, cells, walk);
    }

    // --- 文字列組み立て(グリッド行×ローカル行を上から、列を左から連結) ---
    const rows = [];
    for (let cr = 0; cr < usedR; cr++) {
      for (let lr = 0; lr < S.CHUNK_H; lr++) {
        let line = "";
        for (let c = 0; c < C; c++) line += gridT[cr][c][lr];
        rows.push(line);
      }
    }
    const level = parse(rows);

    // --- スポーン候補(E/C/I)収集。従来 generate と同一ロジック(別系統の乱数) ---
    const srand = rng((sd ^ 0x1234567) >>> 0);
    const dMul = (typeof densityMul === "number") ? densityMul : 1;
    const spawns = [];
    for (let ty = 0; ty < level.h; ty++) {
      for (let tx = 0; tx < level.w; tx++) {
        const ch = level.tiles[ty][tx];
        if (ch === "E" || ch === "C" || ch === "I") {
          const base = (S.SPAWN_RATE && S.SPAWN_RATE[ch] != null) ? S.SPAWN_RATE[ch] : 1;
          const rate = Math.min(1, base * dMul);
          if (srand() < rate) spawns.push({ type: ch, tx, ty });
        }
      }
    }

    level.spawns = spawns;
    level.chunkCount = N;
    level.seed = sd;
    level.goalDist = goalDist;
    level.isBoss = false;
    level.vertical = true;                       // 縦生成で作られたレベル(検証・デバッグ用)
    level.grid = { rows: usedR, cols: C };       // 実際に使ったグリッド寸法
    level.vertMoves = vertMoves;                 // 縦移動の回数(統計用)
    level.leftMoves = leftMoves;                 // 左移動の回数(統計用)
    return level;
  }

  // パスセルの enter(直前の移動)×exit(次の移動)からテンプレートを選ぶ。
  //   idx=0: START(exit=R) / idx=末尾: GOAL(enter=L) / 純横断(L→R): MIDDLE を流用。
  function pickCellTemplate(idx, cells, rand) {
    if (idx === 0) return START;
    if (idx === cells.length - 1) return GOAL;
    const c = cells[idx];
    const e = (c.inMove === "R") ? "L" : (c.inMove === "L") ? "R" : c.inMove;
    const key = e + c.outMove;
    if (key === "LR" || key === "RL") return MIDDLE[pickMiddle(rand, -1)]; // 純横断は既存18種
    const t = VTEMPLATES[key];
    if (Array.isArray(t && t[0])) return t[Math.min(t.length - 1, Math.floor(rand() * t.length))];
    return t || V_SOLID;                     // 想定外(起きない)は塞ぐ
  }

  // 生成レベルの到達性(スタート→ゴール)を、実際の移動モデルの「保守的サブセット」でBFS検証する。
  // 状態=立ちタイル(体が空・足元が壁)。遷移: 横1歩(段差1駆け上がり/歩き落ち)/
  //   接地ジャンプ上昇≤2(+空中ジャンプで計≤4)+頂点で横0〜2ずらして真下着地。装備ボーナスは含めない。
  function checkReachable(level) {
    const solid = (x, y) => solidAt(level, x, y);
    const isStand = (x, y) => !solid(x, y) && solid(x, y + 1);
    // 真下の最初の床の上まで落ちた着地行
    const dropRow = (x, y) => { let ly = y; while (!solid(x, ly + 1)) ly++; return ly; };

    // スタート(足元が空なら落下後の立ち位置に補正)
    const s = { x: level.startX, y: dropRow(level.startX, level.startY) };
    const goalX = level.goalX, goalY = level.goalY;
    const key = (x, y) => x * 100000 + y;
    const seen = new Set([key(s.x, s.y)]);
    const stack = [s];
    const push = (x, y) => { const k = key(x, y); if (!seen.has(k)) { seen.add(k); stack.push({ x, y }); } };

    while (stack.length) {
      const cur = stack.pop();
      const x = cur.x, y = cur.y;
      if (x === goalX && y === goalY) return true;

      // (1) 横1歩(段差1駆け上がり含む)/ 歩き落ち
      for (const d of [-1, 1]) {
        const nx = x + d;
        if (solid(nx, y)) {
          // 目の前が壁 → 1段上が空+自分の頭上が空なら駆け上がり(段差1)
          if (!solid(nx, y - 1) && !solid(x, y - 1)) push(nx, y - 1);
        } else {
          // 前が空 → 進んで、足元が壁なら立ち、空なら真下へ落ちる
          if (solid(nx, y + 1)) push(nx, y);
          else push(nx, dropRow(nx, y));
        }
      }

      // (2) ジャンプ:上昇 rise(1..4。頭上が壁なら打ち止め)→ 頂点で横0〜2ずらす → 真下着地
      for (let rise = 1; rise <= 4; rise++) {
        const ay = y - rise;
        if (solid(x, ay)) break; // 頭上が壁 → これ以上上がれない
        for (const d of [-1, 1]) {
          for (let sh = 1; sh <= 2; sh++) {
            const tc = x + d * sh;
            if (solid(tc, ay)) break; // 頂点の横移動が壁で阻まれた
            push(tc, dropRow(tc, ay));
          }
        }
        // 横ずらし0(真上→真下)は元位置に戻るだけなので省略
      }
    }
    return false;
  }

  // 自動生成。DESIGN §4/§10:
  //   通常: goalDist = totalBeats × ADVANCE_RATE / chunkCount = max(2, round(goalDist/CHUNK_W))
  //         スタート+中間×n+ゴール。
  //   boss=true: 通常区間を「曲の約0.5周分」(totalBeats × BOSS_RATE × ADVANCE_RATE タイル)で生成し、
  //         ゴールの代わりに末尾へボスアリーナ(ARENA)を接続する。level.isBoss / level.arena を持つ。
  //   densityMul: E/C/I マーカーの採用率係数(章の密度)。SPAWN_RATE×densityMul(上限1)でシード抽選する。
  // 返り値: parse済みレベル + spawns[{type,tx,ty}] + chunkCount / seed / goalDist。
  function generate({ totalBeats, seed, boss, densityMul } = {}) {
    const S = CONFIG.STAGE;
    const tb = totalBeats || S.TEST_BEATS;
    const sd = (seed >>> 0);
    const isBoss = !!boss;

    // ===== 縦方向拡張(2Dグリッド生成)。DESIGN §6「縦方向拡張」 =====
    // ボス・無効化・行数抽選=1・パスセル数<4 のいずれかなら、この分岐を素通りして
    // 従来の横一列生成(下の本体)へフォールバックする。行数抽選と縦生成は sd 由来の
    // 「別系統」の乱数だけを使うため、下の `rng(sd)` 本体のストリームは一切汚さない
    // (=フォールバック時の生成結果は従来とバイト単位で一致する)。
    const V = S.VERTICAL;
    if (!isBoss && V && V.ENABLED) {
      const R = pickRows(sd, V.ROW_WEIGHTS || [1]);
      const gDist = tb * S.ADVANCE_RATE;
      const N = Math.max(2, Math.round(gDist / S.CHUNK_W));
      if (R >= 2 && N >= 4) {
        let s2 = sd;
        const maxReroll = (typeof V.MAX_REROLL === "number") ? V.MAX_REROLL : 8;
        for (let attempt = 0; attempt <= maxReroll; attempt++) {
          let lv = null;
          try { lv = generateVertical(s2, R, N, densityMul, gDist); } catch (e) { lv = null; }
          if (lv && checkReachable(lv)) return lv;
          // BFS失敗 → seedを決定的に変換して再生成(同じ初期seedなら必ず同じ結果になる)
          s2 = (Math.imul(s2, 2654435761) + 1) >>> 0;
        }
        // 全リロール失敗 → 下の従来生成へフォールバック(必ず遊べるステージを返す)
      }
    }

    // ===== 従来の横一列生成(以降は改修前と完全に同一。フォールバック/R=1/ボスの経路)=====
    const rand = rng(sd);

    const goalDist = tb * (isBoss ? S.BOSS_RATE : 1) * S.ADVANCE_RATE;
    const chunkCount = Math.max(2, Math.round(goalDist / S.CHUNK_W));

    // スタート → 中間×(chunkCount-2) → ゴール/アリーナ
    const chunks = [START];
    let lastIdx = -1;
    for (let i = 0; i < chunkCount - 2; i++) {
      const idx = pickMiddle(rand, lastIdx);
      chunks.push(MIDDLE[idx]);
      lastIdx = idx;
    }
    // ボスモードは末尾を ARENA(幅24)にする。通常はゴールチャンク(幅16)。
    chunks.push(isBoss ? ARENA : GOAL);

    const rows = concatChunks(chunks);
    const level = parse(rows);

    // スポーン候補(E/C/I)をタイル走査で収集。座標はタイル基準(真実)。
    // densityMul: SPAWN_RATE × densityMul(上限1)でシード抽選し、採用したものだけ spawns に残す。
    //   チャンク配置に影響しないよう、抽選には chunk 選択とは別系統の乱数(seed 由来)を使う。
    const srand = rng((sd ^ 0x1234567) >>> 0);
    const dMul = (typeof densityMul === "number") ? densityMul : 1;
    const spawns = [];
    for (let ty = 0; ty < level.h; ty++) {
      for (let tx = 0; tx < level.w; tx++) {
        const ch = level.tiles[ty][tx];
        if (ch === "E" || ch === "C" || ch === "I") {
          const base = (S.SPAWN_RATE && S.SPAWN_RATE[ch] != null) ? S.SPAWN_RATE[ch] : 1;
          const rate = Math.min(1, base * dMul);
          if (srand() < rate) spawns.push({ type: ch, tx, ty });
        }
      }
    }

    level.spawns = spawns;
    level.chunkCount = chunkCount;
    level.seed = sd;
    level.goalDist = goalDist;
    level.isBoss = isBoss;
    if (isBoss) {
      // アリーナは末尾チャンク。左端の全体列(startX)= ground rows の並びから算出。
      const startX = level.w - S.ARENA_W; // アリーナ左端の全体列
      level.arena = {
        startX,
        leftWall: startX,             // 進入後にせり上げる左壁の列(row5,6,7)
        playLeft: startX + 1,         // せり上げ後の最左通行可能列
        playRight: startX + S.ARENA_W - 2, // 右壁(col23)の1つ内側=最右通行可能列
        triggerX: startX + 3,         // プレイヤーがこの列に到達したらボス戦開始
        groundRow: S.BORDER_GROUND_Y, // 最初の床の行(=8)
        standRow: S.BORDER_GROUND_Y - 1, // 地上ユニットの足元が乗る行(=7)
      };
    }
    return level;
  }

  // 固定テストレベル(デバッグ用・本編未使用)。横64×縦11。
  function testLevel() {
    return [
      "................................................................",
      "................................................................",
      "................................................................",
      "................................................................",
      "................................................................",
      ".................................###............................",
      ".................................###............................",
      "..............####............#.................................",
      "..S.......########............#..........####...............G...",
      "########################..######################################",
      "################################################################",
    ];
  }

  return {
    generate, rng, parse, solidAt, testLevel, MIDDLE, START, GOAL, ARENA,
    // 縦方向拡張(検証・デバッグ用に公開)。DESIGN §6「縦方向拡張」
    generateVertical, checkReachable, pickRows, VTEMPLATES,
  };
})();
