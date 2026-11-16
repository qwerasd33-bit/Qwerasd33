import * as THREE from 'three';
import * as xb from 'xrblocks';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  getActiveHijriImpacts,
  getActiveSeasonalEvent,
  getCommoditySpec,
  getDualCalendarForMonth,
  getLeaderboard,
  getPreviousMonthDelta,
  getYearAndMonthDisplay,
} from '../engine/marketEngine';
import { GameState } from '../types';

export function detectSoftwareWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param) ?? '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return true;
  }
}

function groundHeightAt(x: number, z: number): number {
  const distCamp = Math.hypot(x, z);
  const distTent = Math.hypot(x - 2.6, z + 4.2);
  const campFlatten = Math.min(1, Math.max(0, (distCamp - 2.4) / 3.5));
  const tentFlatten = Math.min(1, Math.max(0, (distTent - 1.8) / 2.2));
  const dunes =
    Math.sin(x * 0.22) * Math.cos(z * 0.19) * 0.48 +
    Math.sin(x * 0.09 + z * 0.11) * 0.35;
  return dunes * campFlatten * tentFlatten;
}

function createSandBumpTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, 256, 256);
    for (let y = 0; y < 256; y += 2) {
      const ripple = Math.sin(y * 0.24) * 18;
      for (let x = 0; x < 256; x += 2) {
        const grain = ((x * 73 + y * 137) % 37) - 18;
        const v = Math.max(0, Math.min(255, Math.round(128 + ripple + grain)));
        ctx.fillStyle = `rgb(${v},${v},${v})`;
        ctx.fillRect(x, y, 2, 2);
      }
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(16, 16);
  return tex;
}

function createContactShadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const grad = ctx.createRadialGradient(64, 64, 6, 64, 64, 62);
    grad.addColorStop(0, 'rgba(0, 0, 0, 0.72)');
    grad.addColorStop(0.55, 'rgba(0, 0, 0, 0.28)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
  }
  const tex = new THREE.CanvasTexture(canvas);
  return tex;
}

export class DesertCampScene extends xb.Script {
  private readonly isSoftwareGl: boolean;
  private ownedGeometries: THREE.BufferGeometry[] = [];
  private ownedMaterials: THREE.Material[] = [];
  private ownedTextures: THREE.Texture[] = [];

  private fireLight?: THREE.PointLight;
  private flameMeshes: THREE.Mesh[] = [];
  private totemCaps: THREE.Mesh[] = [];
  private totemPillars: THREE.Group[] = [];
  private starField?: THREE.Points;

  private spatialCard?: xb.UICard;
  private boardImage?: xb.UIImage;
  private boardCanvas?: HTMLCanvasElement;
  private boardContext?: CanvasRenderingContext2D | null;
  private boardTexture?: THREE.CanvasTexture;
  private elapsed = 0;
  private pendingState: GameState | null = null;

  constructor(isSoftwareGl: boolean) {
    super();
    this.isSoftwareGl = isSoftwareGl;
  }

  init() {
    const renderer = xb.core.renderer as THREE.WebGLRenderer | undefined;
    const scene = xb.core.scene;

    if (renderer) {
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.08;
      renderer.setPixelRatio(
        this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2)
      );
      if (renderer.shadowMap) {
        renderer.shadowMap.enabled = !this.isSoftwareGl;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      }

      try {
        const pmrem = new THREE.PMREMGenerator(renderer);
        scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
        pmrem.dispose();
      } catch {
        // Fallback silently if serializer or headless env lacks PMREM
      }
    }

    scene.background = new THREE.Color(0x0d0f14);
    scene.fog = new THREE.FogExp2(0x0d0f14, 0.042);

    this.setupLighting();
    this.buildNightSkyStars();
    this.buildDesertTerrain();
    this.buildCampfireHearth();
    this.buildMajlisTent();
    this.buildMarketTotems();
    this.buildSpatialMarketBoard();
    if (this.pendingState) {
      this.updateMarketSummary(this.pendingState);
    }
  }

  private trackGeo<T extends THREE.BufferGeometry>(g: T): T {
    this.ownedGeometries.push(g);
    return g;
  }

  private trackMat<T extends THREE.Material>(m: T): T {
    this.ownedMaterials.push(m);
    return m;
  }

  private trackTex<T extends THREE.Texture>(t: T): T {
    this.ownedTextures.push(t);
    return t;
  }

  private setupLighting() {
    // Cool night sky / warm sand bounce hemisphere fill
    const hemi = new THREE.HemisphereLight(0x4b6584, 0x3b2a1a, 1.35);
    this.add(hemi);

    // Warm desert moonlight key light
    const moonKey = new THREE.DirectionalLight(0xffe4b5, 1.8);
    moonKey.position.set(6, 11, 4);
    if (!this.isSoftwareGl) {
      moonKey.castShadow = true;
      moonKey.shadow.mapSize.set(1024, 1024);
      moonKey.shadow.camera.left = -8;
      moonKey.shadow.camera.right = 8;
      moonKey.shadow.camera.top = 8;
      moonKey.shadow.camera.bottom = -8;
      moonKey.shadow.bias = -0.0005;
      moonKey.shadow.normalBias = 0.02;
    }
    this.add(moonKey);

    // Subtle cool rim light from behind camp
    const rim = new THREE.DirectionalLight(0x64748b, 0.7);
    rim.position.set(-5, 4, -8);
    this.add(rim);
  }

  private buildNightSkyStars() {
    const count = 240;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const theta = ((i * 137.5) % 360) * (Math.PI / 180);
      const phi = (((i * 53) % 70) + 12) * (Math.PI / 180);
      const r = 34 + (i % 7);
      positions[i * 3] = r * Math.cos(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.sin(phi) + 1.5;
      positions[i * 3 + 2] = r * Math.cos(phi) * Math.sin(theta);
    }
    const geo = this.trackGeo(new THREE.BufferGeometry());
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = this.trackMat(
      new THREE.PointsMaterial({
        color: 0xf5e6c8,
        size: 0.12,
        transparent: true,
        opacity: 0.75,
        sizeAttenuation: true,
      })
    );
    this.starField = new THREE.Points(geo, mat);
    this.add(this.starField);
  }

  private buildDesertTerrain() {
    const terrainGeo = this.trackGeo(new THREE.PlaneGeometry(60, 60, 48, 48));
    terrainGeo.rotateX(-Math.PI / 2);
    const pos = terrainGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      pos.setY(i, groundHeightAt(x, z));
    }
    terrainGeo.computeVertexNormals();

    const bumpTex = this.trackTex(createSandBumpTexture());
    const terrainMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x3a2e22,
        roughness: 0.92,
        metalness: 0.04,
        bumpMap: bumpTex,
        bumpScale: 0.035,
      })
    );
    const terrain = new THREE.Mesh(terrainGeo, terrainMat);
    terrain.receiveShadow = !this.isSoftwareGl;
    this.add(terrain);
  }

  /**
   * 3-12 part composite procedural Campfire Hearth placed in front of the user.
   */
  private buildCampfireHearth() {
    const hearth = new THREE.Group();
    hearth.position.set(0, 0, -2.55);

    const shadowTex = this.trackTex(createContactShadowTexture());
    const shadowDisc = new THREE.Mesh(
      this.trackGeo(new THREE.CircleGeometry(0.95, 24)),
      this.trackMat(
        new THREE.MeshBasicMaterial({
          map: shadowTex,
          transparent: true,
          opacity: 0.45,
          depthWrite: false,
        })
      )
    );
    shadowDisc.rotation.x = -Math.PI / 2;
    shadowDisc.position.y = 0.015;
    hearth.add(shadowDisc);

    // Ring of 10 river stones
    const stoneGeo = this.trackGeo(new THREE.DodecahedronGeometry(0.085, 0));
    const stoneMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x4b4640,
        roughness: 0.85,
        metalness: 0.08,
      })
    );
    for (let i = 0; i < 10; i++) {
      const angle = (i / 10) * Math.PI * 2;
      const stone = new THREE.Mesh(stoneGeo, stoneMat);
      stone.position.set(Math.cos(angle) * 0.42, 0.05, Math.sin(angle) * 0.42);
      stone.scale.set(1.15, 0.72, 0.95);
      stone.rotation.y = angle;
      hearth.add(stone);
    }

    // Glowing ember bed
    const emberMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x3b1208,
        emissive: 0xd9480f,
        emissiveIntensity: 1.4,
        roughness: 0.9,
      })
    );
    const emberBed = new THREE.Mesh(
      this.trackGeo(new THREE.CylinderGeometry(0.32, 0.36, 0.03, 16)),
      emberMat
    );
    emberBed.position.y = 0.025;
    hearth.add(emberBed);

    // 4 crossed Samer firewood logs
    const logGeo = this.trackGeo(new THREE.CylinderGeometry(0.036, 0.044, 0.56, 10));
    const logMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x3b2416,
        roughness: 0.88,
        metalness: 0.05,
      })
    );
    for (let i = 0; i < 4; i++) {
      const log = new THREE.Mesh(logGeo, logMat);
      const angle = (i * Math.PI) / 2 + 0.3;
      log.position.set(Math.cos(angle) * 0.08, 0.09, Math.sin(angle) * 0.08);
      log.rotation.z = Math.PI / 2 - 0.32;
      log.rotation.y = angle;
      hearth.add(log);
    }

    // 3 sculpted flame tongues
    const flameGeo = this.trackGeo(new THREE.ConeGeometry(0.08, 0.28, 8));
    const flameMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xffb74d,
        emissive: 0xff7b00,
        emissiveIntensity: 2.2,
        roughness: 0.3,
        transparent: true,
        opacity: 0.88,
      })
    );
    for (let i = 0; i < 3; i++) {
      const flame = new THREE.Mesh(flameGeo, flameMat);
      flame.position.set((i - 1) * 0.055, 0.2, (i === 1 ? -0.04 : 0.03));
      flame.scale.setScalar(i === 1 ? 1.15 : 0.82);
      this.flameMeshes.push(flame);
      hearth.add(flame);
    }

    this.fireLight = new THREE.PointLight(0xff8c32, 3.2, 8.5, 1.8);
    this.fireLight.position.set(0, 0.45, 0);
    hearth.add(this.fireLight);

    this.add(hearth);
  }

  /**
   * 3-12 part composite procedural Bedouin Majlis Tent grounded flush to the right-rear.
   */
  private buildMajlisTent() {
    const tent = new THREE.Group();
    const tx = 2.6;
    const tz = -4.2;
    tent.position.set(tx, groundHeightAt(tx, tz), tz);
    tent.rotation.y = -0.48;

    // Grounded braided desert rug (offset >= 0.02 above terrain)
    const rugMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x6b1d22,
        roughness: 0.92,
        metalness: 0.02,
      })
    );
    const rug = new THREE.Mesh(
      this.trackGeo(new THREE.BoxGeometry(2.3, 0.03, 1.8)),
      rugMat
    );
    rug.position.y = 0.025;
    rug.receiveShadow = !this.isSoftwareGl;
    tent.add(rug);

    // Gold trim border on rug
    const trimMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xd4a853,
        roughness: 0.5,
        metalness: 0.45,
      })
    );
    const rugTrim = new THREE.Mesh(
      this.trackGeo(new THREE.BoxGeometry(2.38, 0.018, 1.88)),
      trimMat
    );
    rugTrim.position.y = 0.015;
    tent.add(rugTrim);

    // 4 wooden tent poles
    const poleGeo = this.trackGeo(new THREE.CylinderGeometry(0.035, 0.042, 1.45, 10));
    const poleMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x5c3a21,
        roughness: 0.78,
        metalness: 0.08,
      })
    );
    const poleOffsets: [number, number][] = [
      [-1.05, -0.8],
      [1.05, -0.8],
      [-1.05, 0.8],
      [1.05, 0.8],
    ];
    for (const [px, pz] of poleOffsets) {
      const pole = new THREE.Mesh(poleGeo, poleMat);
      pole.position.set(px, 0.725, pz);
      pole.castShadow = !this.isSoftwareGl;
      tent.add(pole);
    }

    // Center ridge pole
    const ridgePole = new THREE.Mesh(
      this.trackGeo(new THREE.CylinderGeometry(0.04, 0.045, 1.85, 10)),
      poleMat
    );
    ridgePole.position.set(0, 0.925, 0);
    tent.add(ridgePole);

    // Pitched Bedouin canopy roof using ExtrudeGeometry
    const roofShape = new THREE.Shape();
    roofShape.moveTo(-1.35, 1.32);
    roofShape.lineTo(0, 1.88);
    roofShape.lineTo(1.35, 1.32);
    roofShape.lineTo(1.25, 1.24);
    roofShape.lineTo(0, 1.76);
    roofShape.lineTo(-1.25, 1.24);
    roofShape.closePath();

    const roofGeo = this.trackGeo(
      new THREE.ExtrudeGeometry(roofShape, {
        depth: 2.0,
        bevelEnabled: true,
        bevelThickness: 0.03,
        bevelSize: 0.02,
        bevelSegments: 2,
      })
    );
    roofGeo.translate(0, 0, -1.0);
    const canopyMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x1e2028,
        roughness: 0.88,
        metalness: 0.06,
      })
    );
    const canopy = new THREE.Mesh(roofGeo, canopyMat);
    canopy.castShadow = !this.isSoftwareGl;
    tent.add(canopy);

    // Hanging brass lantern inside tent
    const lanternMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xfde68a,
        emissive: 0xf59e0b,
        emissiveIntensity: 1.6,
        roughness: 0.25,
      })
    );
    const lantern = new THREE.Mesh(
      this.trackGeo(new THREE.CylinderGeometry(0.055, 0.045, 0.14, 8)),
      lanternMat
    );
    lantern.position.set(0, 1.48, 0.45);
    tent.add(lantern);

    this.add(tent);
  }

  /**
   * Arc of 5 commodity totem pedestals around the camp showing live market direction pulses.
   */
  private buildMarketTotems() {
    const baseGeo = this.trackGeo(new THREE.CylinderGeometry(0.11, 0.14, 0.08, 12));
    const shaftGeo = this.trackGeo(new THREE.CylinderGeometry(0.055, 0.075, 0.62, 12));
    const capGeo = this.trackGeo(new THREE.OctahedronGeometry(0.08, 0));

    const brassMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xd4a853,
        roughness: 0.25,
        metalness: 0.85,
      })
    );
    const basaltMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: 0x1a1f29,
        roughness: 0.72,
        metalness: 0.15,
      })
    );

    for (let i = 0; i < 5; i++) {
      const angle = -Math.PI * 0.78 + (i / 4) * Math.PI * 0.56;
      const radius = 3.25;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius - 0.6;
      const y = groundHeightAt(x, z);

      const totem = new THREE.Group();
      totem.position.set(x, y, z);

      const base = new THREE.Mesh(baseGeo, brassMat);
      base.position.y = 0.04;
      totem.add(base);

      const shaft = new THREE.Mesh(shaftGeo, basaltMat);
      shaft.position.y = 0.39;
      totem.add(shaft);

      const capMat = this.trackMat(
        new THREE.MeshStandardMaterial({
          color: 0xd4a853,
          emissive: 0xd4a853,
          emissiveIntensity: 0.7,
          roughness: 0.2,
          metalness: 0.5,
        })
      );
      const cap = new THREE.Mesh(capGeo, capMat);
      cap.position.y = 0.84;
      totem.add(cap);

      this.totemCaps.push(cap);
      this.totemPillars.push(totem);
      this.add(totem);
    }
  }

  /**
   * World-space XR Blocks UICard displaying Arabic RTL live market board via high-DPI CanvasTexture.
   */
  private buildSpatialMarketBoard() {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 560;
    const tex = this.trackTex(new THREE.CanvasTexture(canvas));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;

    this.boardCanvas = canvas;
    this.boardContext = canvas.getContext('2d');
    this.boardTexture = tex;

    this.boardImage = new xb.UIImage({
      src: tex,
      ariaLabel: 'لوحة بورصة البر والفعاليات المكانية',
      pointerEvents: 'none',
      style: {
        width: '100%',
        height: '100%',
        objectFit: 'contain',
        borderRadius: 16,
      },
    });

    this.spatialCard = new xb.UICard({
      size: { width: 2.15, height: 1.18 },
      manipulation: true,
      edge: true,
      style: {
        padding: 12,
        borderRadius: 20,
        backgroundColor: 'rgba(13, 15, 20, 0.9)',
      },
      children: [this.boardImage],
    });
    this.spatialCard.name = 'لوحة السوق المكانية';
    this.spatialCard.position.set(0, 1.62, -2.05);
    this.add(this.spatialCard);

    this.drawBoardPlaceholder();
  }

  private drawBoardPlaceholder() {
    const ctx = this.boardContext;
    const canvas = this.boardCanvas;
    if (!ctx || !canvas || !this.boardTexture) return;
    ctx.fillStyle = '#11151d';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#d4a853';
    ctx.font = 'bold 42px Cairo, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('بورصة البر والفعاليات', canvas.width / 2, 240);
    ctx.fillStyle = '#9ca3af';
    ctx.font = '26px IBM Plex Sans Arabic, sans-serif';
    ctx.fillText('جاهز لبدء الجلسة التنافسية', canvas.width / 2, 300);
    this.boardTexture.needsUpdate = true;
  }

  public updateMarketSummary(state: GameState) {
    this.pendingState = state;
    // Update totem colors based on top 5 commodities
    const ids = state.market.activeCommodityIds.slice(0, 5);
    for (let i = 0; i < this.totemCaps.length; i++) {
      const cap = this.totemCaps[i];
      const mat = cap.material as THREE.MeshStandardMaterial;
      const cid = ids[i];
      if (!cid) {
        mat.color.setHex(0x64748b);
        mat.emissive.setHex(0x334155);
        continue;
      }
      const { delta } = getPreviousMonthDelta(
        state.market,
        cid,
        state.currentMonthIndex
      );
      if (delta > 0) {
        mat.color.setHex(0x10b981);
        mat.emissive.setHex(0x059669);
      } else if (delta < 0) {
        mat.color.setHex(0xef4444);
        mat.emissive.setHex(0xdc2626);
      } else {
        mat.color.setHex(0xd4a853);
        mat.emissive.setHex(0xb48a3a);
      }
    }

    // Redraw 3D spatial board canvas
    const ctx = this.boardContext;
    const canvas = this.boardCanvas;
    if (!ctx || !canvas || !this.boardTexture) return;

    const { year, monthInYear, absoluteMonth } = getYearAndMonthDisplay(
      state.currentMonthIndex
    );
    const dual = getDualCalendarForMonth(state.config, state.currentMonthIndex);
    const hijriImpacts = getActiveHijriImpacts(state.market, state.currentMonthIndex);
    const leaderboard = getLeaderboard(state);
    const leader = leaderboard[0];

    ctx.fillStyle = '#0f131b';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = 'rgba(212, 168, 83, 0.35)';
    ctx.lineWidth = 3;
    ctx.strokeRect(14, 14, canvas.width - 28, canvas.height - 28);

    // Header
    ctx.direction = 'rtl';
    ctx.textAlign = 'right';
    ctx.fillStyle = '#d4a853';
    ctx.font = 'bold 32px Cairo, sans-serif';
    ctx.fillText(state.config.sessionName || 'بورصة البر والفعاليات', canvas.width - 42, 62);

    ctx.textAlign = 'left';
    ctx.fillStyle = '#f5f0e6';
    ctx.font = 'bold 23px IBM Plex Sans Arabic, sans-serif';
    const monthBadge =
      state.config.horizonMode === 'unlimited'
        ? `الشهر ${absoluteMonth}`
        : `${absoluteMonth}/${state.config.totalMonths}`;
    ctx.fillText(
      `السنة ${year} · الشهر ${monthInYear} (${monthBadge})`,
      42,
      48
    );

    ctx.fillStyle = '#34d399';
    ctx.font = 'bold 18px IBM Plex Sans Arabic, sans-serif';
    ctx.fillText(dual.shortLabel, 42, 76);

    // Top 5 Commodities
    ctx.strokeStyle = 'rgba(245, 240, 230, 0.12)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(42, 92);
    ctx.lineTo(canvas.width - 42, 92);
    ctx.stroke();

    const rows = state.market.activeCommodityIds.slice(0, 5);
    rows.forEach((cid, idx) => {
      const spec = getCommoditySpec(cid);
      const { current, delta } = getPreviousMonthDelta(
        state.market,
        cid,
        state.currentMonthIndex
      );
      const y = 148 + idx * 66;

      ctx.textAlign = 'right';
      ctx.fillStyle = '#f5f0e6';
      ctx.font = '600 26px IBM Plex Sans Arabic, sans-serif';
      ctx.fillText(spec?.name ?? cid, canvas.width - 48, y);

      ctx.textAlign = 'left';
      ctx.fillStyle = '#f5f0e6';
      ctx.font = 'bold 26px IBM Plex Mono, monospace';
      ctx.fillText(`${current} ر.س`, 240, y);

      const arrow = delta > 0 ? '▲' : delta < 0 ? '▼' : '—';
      ctx.fillStyle =
        delta > 0 ? '#10b981' : delta < 0 ? '#ef4444' : '#9ca3af';
      if (delta === 0) {
        ctx.fillText('ثابت', 48, y);
      } else {
        ctx.direction = 'ltr';
        ctx.fillText(`${arrow} ${delta > 0 ? '+' : ''}${delta}`, 48, y);
        ctx.direction = 'rtl';
      }
    });

    const activeEvent = getActiveSeasonalEvent(state.market, state.currentMonthIndex);
    if (activeEvent) {
      ctx.fillStyle =
        activeEvent.direction === 'up'
          ? 'rgba(16, 185, 129, 0.16)'
          : 'rgba(239, 68, 68, 0.16)';
      ctx.fillRect(36, canvas.height - 134, canvas.width - 72, 40);
      ctx.textAlign = 'right';
      ctx.fillStyle = activeEvent.direction === 'up' ? '#34d399' : '#fca5a5';
      ctx.font = 'bold 21px IBM Plex Sans Arabic, sans-serif';
      const sign = activeEvent.priceDelta > 0 ? '+' : '';
      const pct = Math.round(activeEvent.impactPct * 100);
      ctx.fillText(
        `حدث موسمي: ${activeEvent.title} (${activeEvent.commodityName} ${sign}${pct}% · ${sign}${activeEvent.priceDelta} ر.س)`,
        canvas.width - 52,
        canvas.height - 107
      );
    } else if (hijriImpacts.length > 0) {
      ctx.fillStyle = 'rgba(16, 185, 129, 0.14)';
      ctx.fillRect(36, canvas.height - 134, canvas.width - 72, 40);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#34d399';
      ctx.font = 'bold 20px IBM Plex Sans Arabic, sans-serif';
      const summary = hijriImpacts
        .slice(0, 3)
        .map((imp) => `${imp.commodityName} ${imp.impactPct >= 0 ? '+' : ''}${Math.round(imp.impactPct * 100)}%`)
        .join(' · ');
      ctx.fillText(
        `موسم ${dual.hijriMonthName}: ${summary}`,
        canvas.width - 52,
        canvas.height - 107
      );
    }

    // Footer Leader
    if (leader) {
      ctx.fillStyle = 'rgba(212, 168, 83, 0.14)';
      ctx.fillRect(36, canvas.height - 86, canvas.width - 72, 54);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#d4a853';
      ctx.font = 'bold 24px IBM Plex Sans Arabic, sans-serif';
      ctx.fillText(`المتصدر: ${leader.team.name}`, canvas.width - 54, canvas.height - 50);

      ctx.textAlign = 'left';
      ctx.fillStyle = '#f5f0e6';
      ctx.font = 'bold 24px IBM Plex Mono, monospace';
      ctx.fillText(
        `${leader.netWorth.toLocaleString('en-US')} SAR`,
        54,
        canvas.height - 50
      );
    }

    const prevTex = this.boardTexture;
    const nextTex = new THREE.CanvasTexture(canvas);
    nextTex.colorSpace = THREE.SRGBColorSpace;
    nextTex.minFilter = THREE.LinearFilter;
    nextTex.magFilter = THREE.LinearFilter;
    nextTex.needsUpdate = true;
    this.boardTexture = nextTex;
    this.ownedTextures.push(nextTex);
    if (this.boardImage) {
      this.boardImage.src = nextTex;
    }
    if (prevTex && prevTex !== nextTex) {
      prevTex.dispose();
    }
  }

  update() {
    const dt = xb.getDeltaTime ? xb.getDeltaTime() : 0.016;
    this.elapsed += dt;

    // Gentle campfire flame flicker
    if (this.fireLight) {
      this.fireLight.intensity =
        3.0 + Math.sin(this.elapsed * 9.5) * 0.35 + Math.cos(this.elapsed * 14.3) * 0.2;
    }
    for (let i = 0; i < this.flameMeshes.length; i++) {
      const f = this.flameMeshes[i];
      const baseScale = i === 1 ? 1.15 : 0.82;
      f.scale.y = baseScale + Math.sin(this.elapsed * 11 + i * 2.1) * 0.14;
    }

    // Subtle rotation on commodity crystal caps
    for (let i = 0; i < this.totemCaps.length; i++) {
      this.totemCaps[i].rotation.y += dt * 0.6;
    }
  }

  dispose() {
    for (const g of this.ownedGeometries) g.dispose();
    for (const m of this.ownedMaterials) m.dispose();
    for (const t of this.ownedTextures) t.dispose();
    this.ownedGeometries = [];
    this.ownedMaterials = [];
    this.ownedTextures = [];
  }
}
