// ================================================================
// ar-scene.js : 3D(魔法陣と昆虫)を描くためのファイル
//
// Three.js という3Dライブラリを使っています。
// ・魔法陣 … プログラムで描いた光る円の模様(画像ファイル不要)
// ・昆虫   … models/ フォルダの 3Dモデル(glb/gltf/obj)を読み込む
//            モデルが無いときはテントウムシを自動で作って表示する
// ================================================================

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";

// 昆虫の基本の大きさ(3D空間での大きさ。大きくしたいときはここを変える)
const INSECT_BASE_SIZE = 0.55;

// 魔法陣の基本の大きさ
const CIRCLE_BASE_SIZE = 1.0;

export class ARScene {
  /**
   * @param {HTMLCanvasElement} canvas 3Dを描くキャンバス
   */
  constructor(canvas) {
    // --- 描画エンジン(レンダラー)を作る ---
    // alpha: true で背景を透明にして、下のカメラ映像が見えるようにする
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    // --- 3D空間(シーン)と、それを映すカメラを作る ---
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    this.camera.position.set(0, 0, 2.4);   // カメラを少し手前に置く

    // --- ライト(照明)。これが無いと3Dモデルが真っ暗になる ---
    // 空からの柔らかい光
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x888866, 1.2));
    // 斜め上からの太陽のような光
    const sun = new THREE.DirectionalLight(0xffffff, 1.5);
    sun.position.set(1, 2, 2);
    this.scene.add(sun);

    // --- 魔法陣を作ってシーンに追加(最初は非表示) ---
    this.circleGroup = this.#createMagicCircle();
    this.circleGroup.visible = false;
    this.scene.add(this.circleGroup);

    // --- 昆虫を入れる箱(グループ)を作る(最初は非表示) ---
    // insectGroup   : 位置や大きさを動かすための外側の箱
    // insectModel   : 実際の3Dモデル(読み込み後に中に入れる)
    this.insectGroup = new THREE.Group();
    this.insectGroup.visible = false;
    this.scene.add(this.insectGroup);

    // 投げられたときの速度(3D空間内での移動スピード)
    this.throwVelocity = new THREE.Vector3();
    // 手のひらに追従するときの目標位置(なめらかに追いかけるため)
    this.palmTarget = new THREE.Vector3();
    this.palmScale = 1;

    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  /** 画面サイズが変わったときにキャンバスとカメラを合わせる */
  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /**
   * 画面上のピクセル位置(sx, sy)を、3D空間の座標に変換する
   * (3Dの物体は カメラから見て z=0 の平面上に置く決まりにしている)
   */
  screenToWorld(sx, sy) {
    // カメラから z=0 平面までに見える範囲の高さと幅を計算する
    const fovRad = THREE.MathUtils.degToRad(this.camera.fov / 2);
    const viewHeight = 2 * Math.tan(fovRad) * this.camera.position.z;
    const viewWidth = viewHeight * this.camera.aspect;

    return new THREE.Vector3(
      (sx / window.innerWidth - 0.5) * viewWidth,    // 画面の割合 → 3D の X
      -(sy / window.innerHeight - 0.5) * viewHeight, // Y は上下が逆なのでマイナス
      0
    );
  }

  // ================================================================
  // 魔法陣
  // ================================================================

  /** 魔法陣の模様をプログラムで描いて、光る板(メッシュ)を作る */
  #createMagicCircle() {
    // まず 2D のキャンバスに魔法陣の模様を描く
    const size = 512;
    const cv = document.createElement("canvas");
    cv.width = cv.height = size;
    const ctx = cv.getContext("2d");
    const c = size / 2;                    // 中心の座標

    ctx.strokeStyle = "rgba(255, 220, 120, 0.95)";   // 金色っぽい線
    ctx.shadowColor = "rgba(255, 200, 80, 1)";        // 光っているような影
    ctx.shadowBlur = 12;

    // 外側・内側の円を何重か描く
    for (const [r, w] of [[240, 5], [226, 2], [150, 4], [70, 2]]) {
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.arc(c, c, r, 0, Math.PI * 2);
      ctx.stroke();
    }

    // 星型(五芒星)を描く : 円周上の5点を1つ飛ばしに結ぶ
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let i = 0; i <= 5; i++) {
      const angle = (i * 2 * (Math.PI * 2)) / 5 - Math.PI / 2;  // 2つ飛ばしの角度
      const x = c + Math.cos(angle) * 150;
      const y = c + Math.sin(angle) * 150;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // 円周のまわりに小さな飾り(目盛りと小円)を描く
    for (let i = 0; i < 24; i++) {
      const angle = (i / 24) * Math.PI * 2;
      const x1 = c + Math.cos(angle) * 226;
      const y1 = c + Math.sin(angle) * 226;
      const x2 = c + Math.cos(angle) * 240;
      const y2 = c + Math.sin(angle) * 240;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(c + Math.cos(angle) * 188, c + Math.sin(angle) * 188, 14, 0, Math.PI * 2);
      ctx.stroke();
    }

    // 描いた模様を3Dの「テクスチャ(貼り付ける画像)」にする
    const texture = new THREE.CanvasTexture(cv);

    // 光る板を作る(AdditiveBlending = 光を足し合わせるような表示)
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(CIRCLE_BASE_SIZE, CIRCLE_BASE_SIZE), material);

    // グループに入れて、少し寝かせて立体感を出す
    const group = new THREE.Group();
    group.add(plane);
    group.rotation.x = -0.5;
    this.circlePlane = plane;
    return group;
  }

  /**
   * 魔法陣の見た目を更新する
   * @param {number} progress 0.0(出はじめ) 〜 1.0(完成)
   * @param {number} time     アニメーション用の時間(秒)
   */
  setCircle(progress, time) {
    const p = THREE.MathUtils.clamp(progress, 0, 1);
    // ふわっと大きくなる(easeOut = 最初速く、あとゆっくり)
    const eased = 1 - Math.pow(1 - p, 3);
    const s = this.palmScale * (0.2 + 0.8 * eased);
    this.circleGroup.scale.setScalar(s);
    this.circlePlane.material.opacity = eased;
    // くるくる回転させる
    this.circlePlane.rotation.z = time * 1.5;
    // 手のひらの位置に置く
    this.circleGroup.position.copy(this.palmTarget);
  }

  /** 魔法陣を表示する/隠す */
  showCircle(visible) {
    this.circleGroup.visible = visible;
  }

  // ================================================================
  // 昆虫モデルの読み込み
  // ================================================================

  /**
   * models/config.json を読んで昆虫の3Dモデルを読み込む。
   * 失敗したら(モデル未設置など)テントウムシを自動で作る。
   */
  async loadInsect() {
    // 差し替え用の設定ファイルを読む(無ければ初期値を使う)
    let config = { file: "insect.glb", scale: 1.0, rotationY: 0, offsetY: 0 };
    try {
      const res = await fetch("models/config.json", { cache: "no-store" });
      if (res.ok) config = { ...config, ...(await res.json()) };
    } catch (e) {
      console.info("models/config.json が読めないので初期設定を使います");
    }

    let model = null;
    try {
      model = await this.#loadModelFile("models/" + config.file);
      console.info(`昆虫モデル「${config.file}」を読み込みました`);
    } catch (e) {
      // モデルが無い・読めない場合はテントウムシで代用する
      console.info("3Dモデルが見つからないので、テントウムシを表示します", e);
      model = this.#createFallbackLadybug();
      config.scale = 1.0;
      config.rotationY = 0;
      config.offsetY = 0;
    }

    // --- モデルの大きさを自動でそろえる ---
    // どんな大きさのモデルが来ても、ちょうどいい大きさに縮小/拡大する
    const box = new THREE.Box3().setFromObject(model);
    const sizeVec = box.getSize(new THREE.Vector3());
    const maxSize = Math.max(sizeVec.x, sizeVec.y, sizeVec.z) || 1;
    const fitScale = (INSECT_BASE_SIZE / maxSize) * config.scale;
    model.scale.setScalar(fitScale);

    // モデルの中心が原点(足元が y=0)に来るようにずらす
    const center = box.getCenter(new THREE.Vector3());
    model.position.set(
      -center.x * fitScale,
      (-box.min.y * fitScale) + config.offsetY,   // 一番下を y=0 に合わせる
      -center.z * fitScale
    );

    // config.json で指定された向きに回転(度 → ラジアンに変換)
    const wrapper = new THREE.Group();
    wrapper.rotation.y = THREE.MathUtils.degToRad(config.rotationY);
    wrapper.add(model);

    this.insectGroup.add(wrapper);
  }

  /** ファイルの拡張子(.glb など)を見て、合った読み込み方法でモデルを読む */
  #loadModelFile(path) {
    return new Promise((resolve, reject) => {
      const ext = path.split(".").pop().toLowerCase();

      if (ext === "glb" || ext === "gltf") {
        // GLB / GLTF 形式(おすすめ。色や質感も入っている)
        new GLTFLoader().load(
          path,
          (gltf) => resolve(gltf.scene),
          undefined,
          reject
        );
      } else if (ext === "obj") {
        // OBJ 形式(色が入っていないことが多いので、灰色を付ける)
        new OBJLoader().load(
          path,
          (obj) => {
            obj.traverse((child) => {
              if (child.isMesh) {
                child.material = new THREE.MeshStandardMaterial({ color: 0x999999 });
              }
            });
            resolve(obj);
          },
          undefined,
          reject
        );
      } else {
        reject(new Error("対応していないファイル形式です: " + ext));
      }
    });
  }

  /** 3Dモデルが無いときに表示する、かんたんなテントウムシを作る */
  #createFallbackLadybug() {
    const bug = new THREE.Group();

    // 赤い体(少しつぶした球)
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xdd2222, roughness: 0.4 });
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.5, 24, 16), bodyMat);
    body.scale.set(1, 0.55, 1.2);
    body.position.y = 0.28;
    bug.add(body);

    // 黒い頭
    const blackMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.5 });
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 16, 12), blackMat);
    head.position.set(0, 0.24, 0.55);
    bug.add(head);

    // 白い目(2つ)
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), eyeMat);
      eye.position.set(0.12 * side, 0.36, 0.72);
      bug.add(eye);
    }

    // 背中の黒い点(左右対称に3つずつ)
    for (const side of [-1, 1]) {
      const spotsPos = [
        [0.25 * side, 0.52, 0.15],
        [0.32 * side, 0.42, -0.25],
        [0.15 * side, 0.53, -0.45],
      ];
      for (const [x, y, z] of spotsPos) {
        const spot = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8), blackMat);
        spot.scale.y = 0.3;   // 平たくつぶして模様っぽくする
        spot.position.set(x, y, z);
        bug.add(spot);
      }
    }

    // 6本の足(細い棒)
    for (const side of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const leg = new THREE.Mesh(
          new THREE.CylinderGeometry(0.025, 0.025, 0.35, 6),
          blackMat
        );
        leg.position.set(0.42 * side, 0.1, 0.35 - i * 0.35);
        leg.rotation.z = 0.9 * side;   // 外側にハの字に開く
        bug.add(leg);
      }
    }

    // 2本の触角
    for (const side of [-1, 1]) {
      const antenna = new THREE.Mesh(
        new THREE.CylinderGeometry(0.015, 0.015, 0.25, 6),
        blackMat
      );
      antenna.position.set(0.1 * side, 0.45, 0.68);
      antenna.rotation.x = -0.6;
      antenna.rotation.z = -0.4 * side;
      bug.add(antenna);
    }

    return bug;
  }

  // ================================================================
  // 昆虫のアニメーション
  // ================================================================

  /** 昆虫を表示する/隠す */
  showInsect(visible) {
    this.insectGroup.visible = visible;
  }

  /**
   * 魔法陣から昆虫が出てくるアニメーション
   * @param {number} progress 0.0(出はじめ) 〜 1.0(完全に出た)
   */
  setInsectAppear(progress) {
    const p = THREE.MathUtils.clamp(progress, 0, 1);
    // ぽよんと弾むように大きくなる(easeOutBack という動き)
    const c1 = 1.7;
    const eased = 1 + (c1 + 1) * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2);
    this.insectGroup.scale.setScalar(Math.max(0.001, eased) * this.palmScale);
    // 魔法陣の中から少しずつ浮かび上がる
    this.insectGroup.position.copy(this.palmTarget);
    this.insectGroup.position.y += 0.15 * p * this.palmScale;
  }

  /**
   * 手のひらの上で昆虫がゆらゆらするアニメーション(毎フレーム呼ぶ)
   * @param {number} time 経過時間(秒)
   */
  tickRide(time) {
    // 手のひらの位置になめらかに追従する(lerp = 少しずつ近づく)
    this.insectGroup.position.lerp(
      new THREE.Vector3(
        this.palmTarget.x,
        this.palmTarget.y + 0.15 * this.palmScale + Math.sin(time * 3) * 0.02, // ふわふわ上下
        this.palmTarget.z
      ),
      0.35
    );
    this.insectGroup.scale.setScalar(this.palmScale);
    // 首をかしげるようにゆっくり左右を向く
    this.insectGroup.rotation.y = Math.sin(time * 0.8) * 0.5;
  }

  /**
   * 昆虫を放り投げるアニメーションを開始する
   * @param {THREE.Vector3} velocity 投げる方向とスピード
   */
  startThrow(velocity) {
    this.throwVelocity.copy(velocity);
  }

  /**
   * 投げられた昆虫を動かす(毎フレーム呼ぶ)
   * @param {number} dt 前のフレームからの経過時間(秒)
   * @returns {boolean} 飛んでいき終わったら true
   */
  tickThrow(dt) {
    // 速度に合わせて位置を動かす
    this.insectGroup.position.addScaledVector(this.throwVelocity, dt);
    // 重力で少しずつ落ちる
    this.throwVelocity.y -= 6 * dt;
    // くるくる回りながら飛んでいく
    this.insectGroup.rotation.x += 8 * dt;
    this.insectGroup.rotation.y += 6 * dt;
    // 遠くに行くほど小さく見えるように縮める
    this.insectGroup.scale.multiplyScalar(1 - 1.5 * dt);

    // 十分小さくなるか画面の外に出たら「飛び終わり」
    return this.insectGroup.scale.x < 0.05 || this.insectGroup.position.length() > 8;
  }

  /**
   * 手を見失ったときに昆虫がしゅーっと消えるアニメーション
   * @param {number} progress 0.0 〜 1.0(1.0 で完全に消える)
   */
  setInsectVanish(progress) {
    const p = THREE.MathUtils.clamp(progress, 0, 1);
    this.insectGroup.scale.setScalar(Math.max(0.001, (1 - p) * this.palmScale));
  }

  /**
   * 手のひらの位置と大きさを教える(毎フレーム呼ぶ)
   * @param {THREE.Vector3} worldPos 手のひら中心の3D座標
   * @param {number} scale 手の大きさ(1.0 が標準)
   */
  setPalm(worldPos, scale) {
    // ガタガタしないように、なめらかに目標へ近づける
    this.palmTarget.lerp(worldPos, 0.4);
    this.palmScale += (scale - this.palmScale) * 0.2;
  }

  /** 魔法陣と昆虫をすべて隠して最初の状態に戻す */
  resetAll() {
    this.circleGroup.visible = false;
    this.insectGroup.visible = false;
    this.insectGroup.rotation.set(0, 0, 0);
    this.insectGroup.scale.setScalar(1);
  }

  /** 画面に描く(毎フレーム最後に呼ぶ) */
  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
