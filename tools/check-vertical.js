// tools/check-vertical.js … 縦方向拡張(2Dグリッド生成)のオフライン一括検証(ブラウザ不要)。
// 使い方: node tools/check-vertical.js
//
// CONFIG / LevelGen を vm で読み込み、seed 0〜499 × totalBeats {200,395,438} で generate を実行し、
//   ・例外0件 / 全ケースで checkReachable が真(フォールバック発生数も表示)
//   ・行数分布(グリッド1/2/3行)・縦移動数の統計(ランダム性の確認)
// を出力する。DESIGN §6「縦方向拡張」の検証ステップ。

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
const ctx = {};
vm.createContext(ctx);
const code =
  fs.readFileSync(path.join(root, "js", "config.js"), "utf8") + "\n" +
  fs.readFileSync(path.join(root, "js", "levelgen.js"), "utf8") + "\n" +
  "this.CONFIG = CONFIG; this.LevelGen = LevelGen;";
vm.runInContext(code, ctx, { filename: "combined.js" });
const { CONFIG, LevelGen } = ctx;

// generate 内の縦生成判定(pickRows / N)を外側から再現し、「縦生成が試行されたか」を知る。
// 定数・式は levelgen.js の generate と一致させること。
function planFor(seed, tb) {
  const S = CONFIG.STAGE;
  const V = S.VERTICAL;
  const R = LevelGen.pickRows(seed >>> 0, V.ROW_WEIGHTS || [1]);
  const gDist = tb * S.ADVANCE_RATE;
  const N = Math.max(2, Math.round(gDist / S.CHUNK_W));
  return { R, N, attempted: !!(V && V.ENABLED) && R >= 2 && N >= 4 };
}

const TBS = [200, 395, 438];
const SEEDS = 500;

let cases = 0;
let exceptions = 0;
let reachFail = 0;
let attempted = 0;      // 縦生成を試みたケース
let vertical = 0;       // 実際に縦生成レベルが返ったケース
let fellBack = 0;       // 試みたがBFS全滅で横生成へフォールバックしたケース
const rPicked = { 1: 0, 2: 0, 3: 0 };       // 抽選された行数 R
const usedRows = { 1: 0, 2: 0, 3: 0 };      // 実際に使ったグリッド行数(縦生成レベルのみ)
let vertMoveSum = 0, vertMoveMax = 0, vertMoveMin = Infinity, vertMoveCount = 0;
let leftMoveSum = 0, leftMoveMax = 0, leftMoveMin = Infinity, leftMoveCount = 0;
const failSamples = [];

for (const tb of TBS) {
  for (let seed = 0; seed < SEEDS; seed++) {
    cases++;
    const plan = planFor(seed, tb);
    rPicked[plan.R] = (rPicked[plan.R] || 0) + 1;
    if (plan.attempted) attempted++;

    let lv = null;
    try {
      lv = LevelGen.generate({ totalBeats: tb, seed, boss: false, densityMul: 1 });
    } catch (e) {
      exceptions++;
      failSamples.push(`EXCEPTION tb=${tb} seed=${seed}: ${e.message}`);
      continue;
    }
    // 返ったレベルは常に到達可能であること(縦・横どちらでも)
    let ok = false;
    try { ok = LevelGen.checkReachable(lv); } catch (e) { ok = false; }
    if (!ok) {
      reachFail++;
      if (failSamples.length < 20) failSamples.push(`UNREACHABLE tb=${tb} seed=${seed} vertical=${!!lv.vertical} h=${lv.h}`);
    }

    if (lv.vertical) {
      vertical++;
      const ur = lv.grid ? lv.grid.rows : 1;
      usedRows[ur] = (usedRows[ur] || 0) + 1;
      const vm2 = lv.vertMoves || 0;
      vertMoveSum += vm2;
      vertMoveCount++;
      if (vm2 > vertMoveMax) vertMoveMax = vm2;
      if (vm2 < vertMoveMin) vertMoveMin = vm2;
      const lm2 = lv.leftMoves || 0;
      leftMoveSum += lm2;
      leftMoveCount++;
      if (lm2 > leftMoveMax) leftMoveMax = lm2;
      if (lm2 < leftMoveMin) leftMoveMin = lm2;
    } else if (plan.attempted) {
      fellBack++;
    }
  }
}

console.log("==== 縦方向拡張 一括検証 (check-vertical.js) ====");
console.log(`総ケース数           : ${cases}  (seed 0..${SEEDS - 1} × totalBeats ${JSON.stringify(TBS)})`);
console.log(`例外                 : ${exceptions}`);
console.log(`到達不能(BFS失敗)   : ${reachFail}`);
console.log("");
console.log(`縦生成を試行         : ${attempted}`);
console.log(`  → 縦生成レベル成立 : ${vertical}`);
console.log(`  → フォールバック   : ${fellBack}  (BFS全滅で横一列生成へ)`);
console.log(`行数抽選 R 分布       : R=1:${rPicked[1]}  R=2:${rPicked[2]}  R=3:${rPicked[3]}`);
console.log(`実使用グリッド行数    : 1行:${usedRows[1]}  2行:${usedRows[2]}  3行:${usedRows[3]}  (縦生成レベルのみ)`);
if (vertMoveCount > 0) {
  console.log(`縦移動数(U+D)       : min ${vertMoveMin} / max ${vertMoveMax} / avg ${(vertMoveSum / vertMoveCount).toFixed(2)}`);
  console.log(`左移動数(L)         : min ${leftMoveMin} / max ${leftMoveMax} / avg ${(leftMoveSum / leftMoveCount).toFixed(2)}`);
}
console.log("");

// 決定性(同じ初期seedなら必ず同じ最終レベル)を数件で確認
let detOk = true;
for (const [seed, tb] of [[7, 395], [42, 438], [123, 200]]) {
  const a = LevelGen.generate({ totalBeats: tb, seed, boss: false, densityMul: 1 });
  const b = LevelGen.generate({ totalBeats: tb, seed, boss: false, densityMul: 1 });
  const sa = a.tiles.map((r) => r.join("")).join("\n");
  const sb = b.tiles.map((r) => r.join("")).join("\n");
  if (sa !== sb) { detOk = false; console.log(`DETERMINISM FAIL seed=${seed} tb=${tb}`); }
}
console.log(`決定性(同seed→同レベル): ${detOk ? "OK" : "FAIL"}`);

if (failSamples.length) {
  console.log("\n---- 失敗サンプル(最大20件) ----");
  for (const s of failSamples) console.log("  " + s);
}

const pass = exceptions === 0 && reachFail === 0 && detOk;
console.log("\n判定: " + (pass ? "PASS" : "FAIL"));
process.exit(pass ? 0 : 1);
