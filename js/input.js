// input.js … タッチ入力(4ボタン・マルチタッチ)
// 押した瞬間に SFX.ctx.currentTime を捕まえ、登録されたコールバックへ流す。
// 拍計算に使えるのはこの ctxTime のみ。

const Input = (() => {
  let handler = null; // game.jsが登録する (type, ctxTime) => void

  // コールバック登録
  function onAction(cb) {
    handler = cb;
  }

  // 入力を通知(内部のpointerdownからも、テストからも呼べる公開口)
  function dispatch(type, ctxTime) {
    if (handler) handler(type, ctxTime);
  }

  // 4ボタンに pointerdown を張る。マルチタッチは各ボタン独立で通す。
  function init() {
    const btns = document.querySelectorAll(".act-btn[data-action]");
    btns.forEach((el) => {
      el.addEventListener(
        "pointerdown",
        (e) => {
          e.preventDefault();
          // 押した瞬間のctx時刻を即捕捉
          const ctxTime = SFX.ctx.currentTime;
          const type = el.getAttribute("data-action");
          dispatch(type, ctxTime);
        },
        { passive: false }
      );
    });
  }

  return { init, onAction, dispatch };
})();
