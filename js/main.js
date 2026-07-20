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
const LOST_GRACE = 0.7;      // 手を見失っても待ってあげる秒数(一瞬の見失い対策)
const SHAKE_SPEED = 1.6;     // 「振った!」と判定するスピード(画面の横幅/秒)
const SHAKE_FRAMES = 4;      // 速い動きが何フレーム続いたら「振った」とするか
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

// ---- 各部品(モジュール)を作る ----
const cam = new CameraManager(video);
const tracker = new HandTracker();
const arScene = new ARScene(canvas);

// ---- 状態を管理する変数 ----
let state = "waiting";     // いまの状態
let stateTime = 0;         // いまの状態になってからの経過時間(秒)
let totalTime = 0;         // アプリ開始からの経過時間(秒)
let lostTime = 0;          // 手を見失ってからの経過時間(秒)
let lastFrameTime = 0;     // 前のフレームの時刻(dt 計算用)

// 手を振ったか判定するための、手の位置の履歴
let palmHistory = [];      // { x, y, t } の配列(x, y は画面の割合)
let fastMoveCount = 0;     // 速い動きが連続した回数

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
  if (vw === 0 || vh === 0) return { sx: W / 2, sy: H / 2 };

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

  return { sx, sy };
}

// ================================================================
// 手を振った(昆虫を振り落とす動き)かどうかを判定する
//
// 手の位置の履歴から動くスピードを計算して、
// 「とても速い動き」が数フレーム続いたら「振った!」と判定します。
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
  const speed = Math.hypot(b.x - a.x, b.y - a.y) / dt;

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
    const { sx, sy } = videoToScreen(hand.cx, hand.cy);
    palmScreenX = sx / window.innerWidth;    // 画面の割合(0.0〜1.0)にする
    palmScreenY = sy / window.innerHeight;

    const worldPos = arScene.screenToWorld(sx, sy);

    // 手の大きさ(カメラへの近さ)から、昆虫の表示サイズを決める
    // 0.11 は「標準的な距離での手の大きさ」のめやす
    const palmScale = THREE.MathUtils.clamp(hand.size / 0.11, 0.5, 2.0);

    arScene.setPalm(worldPos, palmScale);
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
          arScene.startThrow(getThrowVelocity());
          setState("thrown");
        }
      } else if (lostTime > LOST_GRACE) {
        // 手を見失った → 昆虫はしゅーっと消える
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

  // --- 4. 3Dを画面に描いて、次のフレームを予約する ---
  arScene.render();
  requestAnimationFrame(mainLoop);
}
