// ================================================================
// main.js : アプリ全体をまとめる司令塔のファイル
//
// アプリは「状態(いまなにをしているか)」を切り替えながら動きます:
//
//   waiting  → 手のひらを探している
//   summon   → 手のひらを見つけた! 魔法陣が出てくる
//   appear   → 魔法陣から昆虫が出てくる(魔法陣は消えていく)
//   ride     → 昆虫が手のひらに乗っている
//   thrown   → 手を振ったので昆虫が飛んでいく(サプライズ機能!)
//   vanish   → 手を見失ったので昆虫が消えていく
//   cooldown → 少し休けい(すぐ次が始まらないように)
// ================================================================

import * as THREE from "three";
import { CameraManager } from "./camera.js";
import { HandTracker } from "./hand-tracker.js";
import { ARScene } from "./ar-scene.js";

// ---------------- 調整しやすい設定値 ----------------
const SUMMON_TIME = 1.5;     // 魔法陣が完成するまでの秒数
const APPEAR_TIME = 0.8;     // 昆虫が出てくるまでの秒数
const VANISH_TIME = 0.5;     // 手を見失って昆虫が消えるまでの秒数
const COOLDOWN_TIME = 1.5;   // 次の魔法陣が出るまでの休けい秒数
const LOST_GRACE = 0.7;      // 魔法陣の途中で手を見失ったときに待つ秒数
const RIDE_LOST_GRACE = 3.0; // 昆虫が乗っているときは長めに待つ(カメラを近づけると
                             // 手の検出が途切れやすいので、すぐ消えないようにする)
const SHAKE_SPEED = 4;       // 「振った!」と判定するスピード(1秒に手のひら何個ぶん動いたか)
                             // ※画面上の速さではなく手の実際の速さで測るので、
                             //   カメラに手を近づけても誤判定しない
const SHAKE_FRAMES = 2;      // 速い動きが何フレーム続いたら「振った」とするか
const SHAKE_LOST_TIME = 0.4; // 速い動きの直後にこの秒数以内に手を見失ったら
                             // 「勢いよく振って手が画面から出た」= 振ったと判定する
const PALM_REAL_SIZE_M = 0.09; // 手のひら(手首〜中指のつけ根)の実寸のめやす: 9cm
                               // 昆虫を実寸表示するための「定規」として使う
// ----------------------------------------------------

// ---- HTML の部品を取得する ----
const video = document.getElementById("camera-video");
const canvas = document.getElementById("ar-canvas");
const introModal = document.getElementById("intro-modal");
const startButton = document.getElementById("start-button");
const loadingOverlay = document.getElementById("loading-overlay");
const errorOverlay = document.getElementById("error-overlay");
const errorMessage = document.getElementById("error-message");
const cameraToggle = document.getElementById("camera-toggle-checkbox");
const shutterButton = document.getElementById("shutter-button");
const flash = document.getElementById("flash");

// ---- 各部品(モジュール)を作る ----
const cam = new CameraManager(video);
const tracker = new HandTracker();
const arScene = new ARScene(canvas);

// ---- 効果音 : 昆虫を投げ飛ばしたときに鳴らす音 ----
const throwSound = new Audio("sounds/throw.mp3");
throwSound.preload = "auto";   // あらかじめ読み込んでおく(鳴らすとき待たされない)

// ---- 状態を管理する変数 ----
let state = "waiting";     // いまの状態
let stateTime = 0;         // いまの状態になってからの経過時間(秒)
let totalTime = 0;         // アプリ開始からの経過時間(秒)
let lostTime = 0;          // 手を見失ってからの経過時間(秒)
let lastFrameTime = 0;     // 前のフレームの時刻(dt 計算用)

// 手を振ったか判定するための、手の位置の履歴
let palmHistory = [];      // { x, y, t } の配列(x, y は画面の横幅を1とした割合)
let fastMoveCount = 0;     // 速い動きが連続した回数
let palmWidthFrac = 0.2;   // 手のひらの大きさ(画面の横幅を1とした割合)。振り判定に使う
let lastShakeSpeed = 0;    // 最後に測った手のスピード(デバッグ表示用)

// ---- デバッグ表示 ----
// アドレスの最後に「?debug」を付けて開くと(例 : .../index.html?debug)、
// 手のスピードの数値が画面に表示される。SHAKE_SPEED の調整に使う
let debugPanel = null;
if (new URLSearchParams(location.search).has("debug")) {
  debugPanel = document.createElement("div");
  debugPanel.style.cssText =
    "position:fixed; top:60px; left:12px; z-index:50; color:#0f0;" +
    "background:rgba(0,0,0,0.6); padding:8px 12px; border-radius:8px;" +
    "font-size:14px; font-family:monospace; white-space:pre;";
  document.body.appendChild(debugPanel);
}

/** 状態を切り替える */
function setState(next) {
  state = next;
  stateTime = 0;
}

/** エラーメッセージを画面に表示する */
function showError(message) {
  errorMessage.textContent = message;
  errorOverlay.hidden = false;
}

// ================================================================
// 「はじめる!」ボタンが押されたらアプリを開始する
// ================================================================
startButton.addEventListener("click", async () => {
  // カメラが使えない環境(httpでアクセスした等)かチェックする
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showError(
      "カメラが使えません。\nhttps:// のアドレスか、\nパソコンなら http://localhost で開いてください。"
    );
    return;
  }

  introModal.style.display = "none";   // 説明ウィンドウを閉じる
  loadingOverlay.hidden = false;       // 「じゅんびちゅう…」を表示

  // スマホは「ユーザーがタップした直後」しか音を出す許可がもらえないため、
  // このボタンが押されたタイミングで一度だけ再生して、音を出せる状態にしておく。
  // ミュートにしてから再生するので、このとき音は聞こえない
  throwSound.muted = true;
  throwSound.play().then(() => {
    throwSound.pause();
    throwSound.currentTime = 0;
    throwSound.muted = false;   // ミュート解除。次からはちゃんと音が鳴る
  }).catch(() => {
    throwSound.muted = false;   // 音が使えなくてもアプリは動かす
  });

  try {
    // カメラ・手の検出・昆虫モデルを同時に準備する(並行して待つと速い)
    await Promise.all([
      cam.start("environment"),        // そとカメラ(背面)で開始
      tracker.init(),                  // 手の検出AIを読み込む
      arScene.loadInsect(),            // 昆虫の3Dモデルを読み込む
    ]);
  } catch (e) {
    console.error(e);
    showError(
      "カメラを開始できませんでした。\nカメラの使用を「きょか」して、\nページを読み込み直してください。"
    );
    return;
  }

  loadingOverlay.hidden = true;
  shutterButton.hidden = false;   // 準備ができたので撮影ボタンを表示する

  // メインループ(1秒間に約60回、画面を更新し続ける)を開始する
  lastFrameTime = performance.now();
  requestAnimationFrame(mainLoop);
});

// ================================================================
// カメラ切り替えトグルスイッチ
// ================================================================
cameraToggle.addEventListener("change", async () => {
  // チェックあり = インカメラ / チェックなし = そとカメラ
  const facing = cameraToggle.checked ? "user" : "environment";
  try {
    await cam.start(facing);
  } catch (e) {
    console.error("カメラの切り替えに失敗しました", e);
  }
});

// ================================================================
// 写真をとるシャッターボタン
//
// カメラ映像と3D(昆虫)を1枚の画像に合成して保存します。
// スマホでは「共有」画面が開くので、そこから写真に保存できます。
// ================================================================
shutterButton.addEventListener("click", async () => {
  // --- シャッターの白い光の演出 ---
  flash.classList.add("active");
  setTimeout(() => flash.classList.remove("active"), 100);

  // --- 合成用のキャンバスを用意する(画面と同じ縦横比・高解像度) ---
  const W = window.innerWidth;
  const H = window.innerHeight;
  const dpr = Math.min(window.devicePixelRatio, 2);   // 高解像度画面対応
  const photoCanvas = document.createElement("canvas");
  photoCanvas.width = W * dpr;
  photoCanvas.height = H * dpr;
  const ctx = photoCanvas.getContext("2d");
  ctx.scale(dpr, dpr);

  // --- 1枚目 : カメラ映像を描く(画面と同じ「はみ出し拡大」で) ---
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (vw > 0 && vh > 0) {
    const scale = Math.max(W / vw, H / vh);
    const dw = vw * scale;
    const dh = vh * scale;
    const offsetX = (W - dw) / 2;
    const offsetY = (H - dh) / 2;

    if (cam.isMirrored) {
      // インカメラのときは画面と同じように左右反転して描く
      ctx.save();
      ctx.translate(W, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(video, offsetX, offsetY, dw, dh);
      ctx.restore();
    } else {
      ctx.drawImage(video, offsetX, offsetY, dw, dh);
    }
  }

  // --- 2枚目 : 3D(昆虫や魔法陣)を上に重ねて描く ---
  // 直前に一度描画しておくと、確実に最新の絵が取れる
  arScene.render();
  ctx.drawImage(canvas, 0, 0, W, H);

  // --- 画像ファイルにして保存する ---
  photoCanvas.toBlob(async (blob) => {
    if (!blob) return;

    // ファイル名に日時を入れる(例 : mushimiru_2026-07-20_15-30-00.png)
    const stamp = new Date().toISOString().slice(0, 19).replace("T", "_").replaceAll(":", "-");
    const fileName = `mushimiru_${stamp}.png`;
    const file = new File([blob], fileName, { type: "image/png" });

    // スマホなら「共有」画面を開く(写真アプリに保存できる)
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file] });
        return;
      } catch (e) {
        // 共有をキャンセルしただけなら何もしない
        if (e.name === "AbortError") return;
        // 共有に失敗したら、下のダウンロード保存に進む
      }
    }

    // パソコンなど共有が使えない場合は、そのままダウンロード保存する
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  }, "image/png");
});

// ================================================================
// 手の位置(映像内の割合)を画面のピクセル位置に変換する
//
// カメラ映像は object-fit: cover で画面いっぱいに拡大されていて
// 上下または左右がはみ出しているので、その分を計算で合わせます。
// ================================================================
function videoToScreen(nx, ny) {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const W = window.innerWidth;
  const H = window.innerHeight;
  if (vw === 0 || vh === 0) return { sx: W / 2, sy: H / 2, dh: H };

  // 映像を画面いっぱいに広げたときの拡大率(大きい方に合わせる)
  const scale = Math.max(W / vw, H / vh);
  const dw = vw * scale;             // 拡大後の映像の横幅
  const dh = vh * scale;             // 拡大後の映像の縦幅
  const offsetX = (W - dw) / 2;      // はみ出して見えない部分(左)
  const offsetY = (H - dh) / 2;      // はみ出して見えない部分(上)

  let sx = nx * dw + offsetX;
  let sy = ny * dh + offsetY;

  // インカメラのときは映像を左右反転して表示しているので、位置も反転する
  if (cam.isMirrored) sx = W - sx;

  // dh(拡大後の映像の縦幅)は、手の大きさをピクセルに換算するのに使う
  return { sx, sy, dh };
}

// ================================================================
// 手を振った(昆虫を振り落とす動き)かどうかを判定する
//
// 手の位置の履歴から動くスピードを計算して、
// 「とても速い動き」が数フレーム続いたら「振った!」と判定します。
//
// スピードは「1秒に手のひら何個ぶん動いたか」で測ります。
// 画面上の速さで測ると、カメラに手を近づけただけで
// 大きく動いたことになってしまい誤判定するためです。
// ================================================================
function checkShake(px, py, now) {
  palmHistory.push({ x: px, y: py, t: now });
  // 古い履歴(0.3秒より前)は捨てる
  palmHistory = palmHistory.filter((h) => now - h.t < 300);

  if (palmHistory.length < 2) return false;

  // 直近2点の間のスピードを計算する(単位 : 画面の横幅ぶん/秒)
  const a = palmHistory[palmHistory.length - 2];
  const b = palmHistory[palmHistory.length - 1];
  const dt = (b.t - a.t) / 1000;
  if (dt <= 0) return false;
  const screenSpeed = Math.hypot(b.x - a.x, b.y - a.y) / dt;

  // 手のひらの大きさで割って「手のひら何個ぶん/秒」に変換する
  const speed = screenSpeed / Math.max(palmWidthFrac, 0.01);
  lastShakeSpeed = speed;   // デバッグ表示用に記録

  // 速い動きが連続しているかを数える
  if (speed > SHAKE_SPEED) {
    fastMoveCount++;
  } else {
    fastMoveCount = 0;
  }

  return fastMoveCount >= SHAKE_FRAMES;
}

/** 直近の手の動きから、昆虫を投げ飛ばす方向(3D)を計算する */
function getThrowVelocity() {
  const first = palmHistory[0];
  const last = palmHistory[palmHistory.length - 1];
  const dt = Math.max((last.t - first.t) / 1000, 0.05);

  // 手が動いていた方向に飛ばす(画面の割合 → 3D空間のスピードに変換)
  let vx = ((last.x - first.x) / dt) * 2.0;
  let vy = -((last.y - first.y) / dt) * 2.0;   // 画面とy軸の向きが逆なのでマイナス

  const v = new THREE.Vector3(vx, vy + 1.5, -4.0);   // 少し上+奥へ飛ばす
  v.clampLength(3, 7);                                // 速すぎ・遅すぎを防ぐ
  return v;
}

/** 昆虫を投げ飛ばす(アニメーション開始+効果音) */
function doThrow() {
  arScene.startThrow(getThrowVelocity());
  // 効果音を最初から鳴らす
  throwSound.currentTime = 0;
  throwSound.play().catch(() => { /* 音が鳴らせなくても続行 */ });
  setState("thrown");
}

// ================================================================
// メインループ : 毎フレーム(1秒に約60回)呼ばれる心臓部
// ================================================================
function mainLoop(now) {
  // 前のフレームからの経過時間(秒)。アニメーションを滑らかにするのに使う
  const dt = Math.min((now - lastFrameTime) / 1000, 0.1);
  lastFrameTime = now;
  totalTime += dt;
  stateTime += dt;

  // --- 1. カメラ映像から手を検出する ---
  const hand = tracker.detect(video, now);

  // --- 2. 手が見つかったら位置を3D空間の座標に変換して伝える ---
  let palmScreenX = 0;
  let palmScreenY = 0;
  if (hand.found) {
    const { sx, sy, dh } = videoToScreen(hand.cx, hand.cy);
    // 振り判定用に「画面の横幅を1とした割合」に変換する(縦も横幅で割って単位をそろえる)
    palmScreenX = sx / window.innerWidth;
    palmScreenY = sy / window.innerWidth;

    const worldPos = arScene.screenToWorld(sx, sy);

    // --- 実寸表示のための計算 ---
    // 画面に写った手のひらの大きさ(ピクセル)を測り、
    // 「実物の手のひらは約9cm」という仮定から
    // 「実寸1メートル = 3D空間で何単位か」(metersToWorld)を求める。
    // これが定規の代わりになって、昆虫が実物大で表示される
    const palmSizePx = hand.size * dh;                          // 手の大きさ(ピクセル)
    palmWidthFrac = palmSizePx / window.innerWidth;             // 振り判定用に記録しておく
    const palmWorldSize = palmSizePx * arScene.worldUnitsPerPixel();  // → 3D空間の単位
    const metersToWorld = THREE.MathUtils.clamp(
      palmWorldSize / PALM_REAL_SIZE_M,
      1, 40   // 極端な値にならないように制限(手の誤検出対策)
    );

    arScene.setPalm(worldPos, metersToWorld);
    lostTime = 0;
  } else {
    lostTime += dt;
  }

  // --- 3. いまの状態に合わせて動きを決める(状態マシン) ---
  switch (state) {
    // 手のひらを探している
    case "waiting":
      if (hand.found && hand.isOpen) {
        // パーに開いた手を見つけた! → 魔法陣を出す
        arScene.showCircle(true);
        setState("summon");
      }
      break;

    // 魔法陣が出てくる
    case "summon": {
      if (lostTime > LOST_GRACE) {
        // 手を見失ったのでやり直し
        arScene.resetAll();
        setState("waiting");
        break;
      }
      const p = stateTime / SUMMON_TIME;
      arScene.setCircle(p, totalTime);
      if (p >= 1) {
        // 魔法陣が完成した! → 昆虫が出てくる
        arScene.showInsect(true);
        setState("appear");
      }
      break;
    }

    // 魔法陣から昆虫が出てくる(魔法陣はだんだん消える)
    case "appear": {
      const p = stateTime / APPEAR_TIME;
      arScene.setCircle(1 - p, totalTime);    // 魔法陣をフェードアウト
      arScene.setInsectAppear(p);
      if (p >= 1) {
        arScene.showCircle(false);            // 魔法陣を完全に消す
        palmHistory = [];
        fastMoveCount = 0;
        setState("ride");
      }
      break;
    }

    // 昆虫が手のひらに乗っている
    case "ride":
      arScene.tickRide(totalTime);

      if (hand.found) {
        // 手を振ったかチェック(サプライズ機能!)
        if (checkShake(palmScreenX, palmScreenY, now)) {
          doThrow();
        }
      } else if (fastMoveCount >= 1 && lostTime < SHAKE_LOST_TIME) {
        // 速い動きの直後に手を見失った!
        // = 勢いよく振って手がカメラの画面から飛び出したということ。
        // 本気で振ると手はブレて検出できなくなるので、これも「振った」と判定する
        fastMoveCount = 0;
        doThrow();
      } else if (lostTime > RIDE_LOST_GRACE) {
        // 手を長いあいだ見失った → 昆虫はしゅーっと消える
        // (カメラを手に近づけると検出が一瞬途切れることがあるので、
        //  RIDE_LOST_GRACE 秒はその場で待ってあげる)
        setState("vanish");
      }
      break;

    // 昆虫が投げ飛ばされて飛んでいく
    case "thrown":
      if (arScene.tickThrow(dt)) {
        arScene.resetAll();
        setState("cooldown");
      }
      break;

    // 手を見失って昆虫が消えていく
    case "vanish": {
      const p = stateTime / VANISH_TIME;
      arScene.setInsectVanish(p);
      if (p >= 1) {
        arScene.resetAll();
        setState("cooldown");
      }
      break;
    }

    // 少し休けい(連続で魔法陣が出ないようにする)
    case "cooldown":
      if (stateTime >= COOLDOWN_TIME) {
        setState("waiting");
      }
      break;
  }

  // --- デバッグ表示(アドレスに ?debug を付けたときだけ) ---
  if (debugPanel) {
    debugPanel.textContent =
      `じょうたい: ${state}\n` +
      `はやさ: ${lastShakeSpeed.toFixed(1)} てのひら/秒 (しきい値 ${SHAKE_SPEED})\n` +
      `手のけんしゅつ: ${hand.found ? "○" : "×"}  速い動き連続: ${fastMoveCount}`;
  }

  // --- 4. 3Dを画面に描いて、次のフレームを予約する ---
  arScene.render();
  requestAnimationFrame(mainLoop);
}
