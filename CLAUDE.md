# リズムダンジョン(仮)

マッドラットデッド型の「リズムアクション × 自動生成ダンジョン」。スマホ横画面・タッチ操作専用。
素の HTML/CSS/JS + Canvas のみで作る(ライブラリ・ビルドシステム・npm依存は追加しない)。

**設計の全容は `DESIGN.md` を必ず読むこと。** 仕様の疑問はまず DESIGN.md を参照する。

## 役割分担
- **設計・実装指示書・レビュー・コミット/プッシュ**: メインセッション=ディレクター
  (〜2026-07-07: Fable 5 / 2026-07-08〜: Opus 4.8 が代行)
- **難所の実装**(Conductor・判定・アクション基盤・自動生成・敵AI・ボス): `implementer-opus` エージェント
- **定型の実装**(UI/CSS・CONFIG調整・データ駆動コンテンツ追加・ホーム画面): `implementer-sonnet` エージェント

**メインセッションを務めるモデルは、着手前に必ず `.claude/skills/director/SKILL.md`(ディレクター引き継ぎ書)を読むこと。**
タスク分解・自己検証・判断基準・既知の落とし穴・残タスクが全て書いてある。
メインセッションはステップごとに実装指示書を書いてエージェントに渡し、成果をレビューしてからコミットする。
実装エージェントはコミット・プッシュをしない。曲の解析は `tools/analyze-song.js` を使う。

## 鉄則
- 拍・タイミングの計算に使う時計は `AudioContext.currentTime` のみ(rAFは描画補間のみ)
- 内部座標はタイル単位で量子化、見た目はトゥイーン補間(DESIGN.md §3)
- 調整値は `js/config.js` の `CONFIG` に全集約。コンテンツ追加はデータを足す方式
- コメント・UI文言は日本語

## 検証
- `node --check <file>` で構文確認
- `python3 -m http.server <port>` で配信し、Playwright + `/opt/pw-browsers/chromium` のヘッドレスで
  スマホ横画面ビューポート(844×390, isMobile, hasTouch)を開き pageerror 0件+機能動作を確認
- `?debug=1` で拍タイミングのデバッグHUDを表示
- `AudioContext` はタップ後でないと開始しない(iOS Safari 対策)。検証時は開始タップを挟む

## 注意
- `songs/` の音源はユーザー私用。public リポジトリだが GitHub Pages 等での一般公開・URL拡散はしない
