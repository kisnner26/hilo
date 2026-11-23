import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { forceLink, forceManyBody, forceSimulation } from 'd3-force-3d';

export interface NodoVista {
  id: string;
  label: string;
  comunidad: number;
  nombreComunidad: string;
  archivo?: string;
  tipo?: string;
}
export interface EnlaceVista {
  origen: string;
  destino: string;
  relacion: string;
}

export interface Ajustes {
  color: string;
  brillo: number;
  tamBrillo: number;
  tamNodo: number;
  enlaces: number;
  anillos: number;
  perlas: number;
  velPerlas: number;
  giro: number;
  cometas: boolean;
  pulso: boolean;
  estrellas: boolean;
  nombres: boolean;
  ahorrarGpu: boolean;
  calidad: 'rapida' | 'alta' | 'maxima';
  plano: boolean;
}

/** Valores que se ven en el panel de referencia. */
export const AJUSTES_POR_DEFECTO: Ajustes = {
  color: '#ffffff',
  brillo: 1.75,
  tamBrillo: 0.75,
  tamNodo: 0.3,
  enlaces: 0.9,
  anillos: 0.05,
  perlas: 800,
  velPerlas: 4,
  giro: 2,
  cometas: true,
  pulso: true,
  estrellas: true,
  nombres: true,
  ahorrarGpu: true,
  calidad: 'maxima',
  plano: false,
};

export const PALETA = ['#3dff88', '#ffffff', '#a8d8ff', '#a78bfa', '#f4b860', '#e8e8e8'];

interface Sim {
  id: string;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  fx?: number;
  fy?: number;
  fz?: number;
  c: number;
  grado: number;
}

const NUCLEO = '__nucleo';
const MORADO = new THREE.Color('#a78bfa');

const VERT = /* glsl */ `
  attribute float tam;
  attribute float fase;
  attribute vec3 col;
  uniform float uEscala;
  uniform float uTiempo;
  uniform float uPulso;
  uniform float uTam;
  varying vec3 vCol;
  void main() {
    vCol = col;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float p = 1.0 + uPulso * 0.28 * sin(uTiempo * 2.0 + fase);
    gl_PointSize = max(1.5, tam * uTam * p * uEscala / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;
const FRAG = /* glsl */ `
  uniform float uBrillo;
  uniform float uHalo;
  varying vec3 vCol;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    if (d > 1.0) discard;
    float nucleo = smoothstep(0.30, 0.0, d);
    float halo = exp(-d * d * (7.0 - 4.5 * uHalo)) * uBrillo * 0.16;
    float a = clamp(nucleo + halo, 0.0, 1.0);
    gl_FragColor = vec4(vCol * (nucleo + halo), a);
  }
`;

export class Galaxia {
  readonly dom: HTMLCanvasElement;
  ajustes: Ajustes = { ...AJUSTES_POR_DEFECTO };
  alPasar: (n: NodoVista | null, x: number, y: number) => void = () => {};
  alElegir: (n: NodoVista | null) => void = () => {};
  alFps: (fps: number) => void = () => {};

  private renderer: THREE.WebGLRenderer;
  private escena = new THREE.Scene();
  private camara: THREE.PerspectiveCamera;
  private controles: OrbitControls;
  private compositor: EffectComposer;
  private bloom: UnrealBloomPass;
  private grupo = new THREE.Group();
  private nodos: NodoVista[] = [];
  private enlaces: EnlaceVista[] = [];
  private sim: Sim[] = [];
  private indice = new Map<string, number>();
  private simulacion: ReturnType<typeof forceSimulation> | undefined;
  private puntos!: THREE.Points;
  private lineas!: THREE.LineSegments;
  private resaltadas!: THREE.LineSegments;
  private perlasPts!: THREE.Points;
  private estrellasPts!: THREE.Points;
  private anillosObj = new THREE.Group();
  private colores!: Float32Array;
  private coloresBase!: Float32Array;
  private perlaEnlace = new Int32Array(0);
  private perlaT = new Float32Array(0);
  private perlaV = new Float32Array(0);
  private ady = new Map<number, number[]>();
  private centrosCom: { x: number; y: number; z: number; n: number; nombre: string }[] = [];
  private etiquetas: HTMLElement;
  private raf = 0;
  private reloj = new THREE.Clock();
  private fps = { n: 0, t: performance.now() };
  private hover = -1;
  private elegido = -1;
  private vuelo: { desde: THREE.Vector3; hasta: THREE.Vector3; t: number } | undefined;
  private oculto = false;
  private ticks = 0;
  private radio = 200;
  private observador: ResizeObserver;

  constructor(private contenedor: HTMLElement, etiquetas: HTMLElement) {
    this.etiquetas = etiquetas;
    this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x000000, 1);
    this.dom = this.renderer.domElement;
    contenedor.appendChild(this.dom);
    this.camara = new THREE.PerspectiveCamera(55, 1, 0.5, 5000);
    this.controles = new OrbitControls(this.camara, this.dom);
    this.controles.enableDamping = true;
    this.controles.dampingFactor = 0.07;
    this.controles.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    this.escena.add(this.grupo, this.anillosObj);
    this.compositor = new EffectComposer(this.renderer);
    this.compositor.addPass(new RenderPass(this.escena, this.camara));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.5, 0.35);
    this.compositor.addPass(this.bloom);
    this.compositor.addPass(new OutputPass());
    this.crearEstrellas();
    this.observador = new ResizeObserver(() => this.ajustarTamano());
    this.observador.observe(contenedor);
    this.dom.addEventListener('pointermove', this.moverPuntero);
    this.dom.addEventListener('click', this.clic);
    document.addEventListener('visibilitychange', this.visibilidad);
    this.ajustarTamano();
    this.aplicarAjustes();
    this.reloj.start();
    this.raf = requestAnimationFrame(this.cuadro);
  }

  // ---------- datos ----------

  cargar(nodos: NodoVista[], enlaces: EnlaceVista[]): void {
    this.nodos = nodos;
    this.enlaces = enlaces.filter((e) => nodos.some((n) => n.id === e.origen) && nodos.some((n) => n.id === e.destino));
    this.reconstruir();
  }

  private reconstruir(): void {
    for (const o of [this.puntos, this.lineas, this.resaltadas, this.perlasPts]) {
      if (o) {
        this.grupo.remove(o);
        o.geometry.dispose();
      }
    }
    this.indice.clear();
    this.ady.clear();
    const comunidades = [...new Set(this.nodos.map((n) => n.comunidad))].sort((a, b) => a - b);
    const nombreDe = new Map(this.nodos.map((n) => [n.comunidad, n.nombreComunidad]));

    this.sim = this.nodos.map((n, i) => {
      const c = comunidades.indexOf(n.comunidad);
      const ang = c * 2.4 + Math.random() * 0.6;
      const r = 90 + c * 36 + Math.random() * 90;
      this.indice.set(n.id, i);
      return { id: n.id, x: Math.cos(ang) * r, y: (Math.random() - 0.5) * 40, z: Math.sin(ang) * r, vx: 0, vy: 0, vz: 0, c, grado: 0 };
    });
    for (const e of this.enlaces) {
      const a = this.indice.get(e.origen)!;
      const b = this.indice.get(e.destino)!;
      this.sim[a]!.grado++;
      this.sim[b]!.grado++;
      this.ady.set(a, [...(this.ady.get(a) ?? []), b]);
      this.ady.set(b, [...(this.ady.get(b) ?? []), a]);
    }
    // Núcleo virtual: unido al nodo más conectado de cada comunidad, como el centro luminoso de la referencia.
    const nucleo: Sim = { id: NUCLEO, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, fx: 0, fy: 0, fz: 0, c: -1, grado: 0 };
    const lazos: { source: string; target: string }[] = this.enlaces.map((e) => ({ source: e.origen, target: e.destino }));
    for (const c of comunidades) {
      const mejor = this.sim.filter((s) => comunidades[s.c] === c).sort((a, b) => b.grado - a.grado)[0];
      if (mejor) {
        lazos.push({ source: NUCLEO, target: mejor.id });
        nucleo.grado++;
      }
    }
    this.sim.push(nucleo);
    this.principales = [];
    this.centrosCom = comunidades.map((c) => ({ x: 0, y: 0, z: 0, n: 0, nombre: nombreDe.get(c) ?? '' }));

    const n = this.sim.length;
    const posiciones = new Float32Array(n * 3);
    const tam = new Float32Array(n);
    const fase = new Float32Array(n);
    this.colores = new Float32Array(n * 3);
    this.coloresBase = new Float32Array(n * 3);
    const base = new THREE.Color(this.ajustes.color);
    this.sim.forEach((s, i) => {
      const esNucleo = s.id === NUCLEO;
      tam[i] = esNucleo ? 0.01 : 2.2 + Math.min(4, Math.sqrt(s.grado) * 0.8);
      fase[i] = Math.random() * 6.28;
      const c = esNucleo ? new THREE.Color('#ffffff') : base.clone().lerp(new THREE.Color('#9fb4c8'), (s.c % 5) / 12);
      this.coloresBase.set([c.r, c.g, c.b], i * 3);
      this.colores.set([c.r, c.g, c.b], i * 3);
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(posiciones, 3));
    geo.setAttribute('tam', new THREE.BufferAttribute(tam, 1));
    geo.setAttribute('fase', new THREE.BufferAttribute(fase, 1));
    geo.setAttribute('col', new THREE.BufferAttribute(this.colores, 3));
    this.puntos = new THREE.Points(
      geo,
      new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uEscala: { value: 300 }, uTiempo: { value: 0 }, uPulso: { value: 1 }, uTam: { value: 1 }, uBrillo: { value: 1.75 }, uHalo: { value: 0.75 } },
      }),
    );
    this.puntos.frustumCulled = false;

    const lineaGeo = new THREE.BufferGeometry();
    lineaGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(lazos.length * 6), 3));
    this.lineas = new THREE.LineSegments(lineaGeo, new THREE.LineBasicMaterial({ color: 0xc8d0da, transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.lineas.frustumCulled = false;
    const resGeo = new THREE.BufferGeometry();
    resGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
    this.resaltadas = new THREE.LineSegments(resGeo, new THREE.LineBasicMaterial({ color: MORADO, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.resaltadas.frustumCulled = false;

    // Perlas de luz que viajan por los enlaces.
    const PERLAS = 1500;
    this.perlaEnlace = new Int32Array(PERLAS).map(() => Math.floor(Math.random() * Math.max(1, lazos.length)));
    this.perlaT = new Float32Array(PERLAS).map(() => Math.random());
    this.perlaV = new Float32Array(PERLAS).map(() => 0.25 + Math.random() * 0.75);
    const perlasGeo = new THREE.BufferGeometry();
    perlasGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(PERLAS * 3), 3));
    perlasGeo.setAttribute('tam', new THREE.BufferAttribute(new Float32Array(PERLAS).map((_, i) => (i % 22 === 0 ? 9 : 3)), 1));
    perlasGeo.setAttribute('fase', new THREE.BufferAttribute(new Float32Array(PERLAS), 1));
    perlasGeo.setAttribute('col', new THREE.BufferAttribute(new Float32Array(PERLAS * 3).fill(0.9), 3));
    this.perlasPts = new THREE.Points(perlasGeo, (this.puntos.material as THREE.ShaderMaterial).clone());
    this.perlasPts.frustumCulled = false;
    this.lazosSim = lazos;

    if (this.nucleoSprite) {
      this.grupo.remove(this.nucleoSprite);
      this.nucleoSprite.material.dispose();
    }
    this.nucleoSprite = this.crearNucleo();
    this.grupo.add(this.lineas, this.resaltadas, this.puntos, this.perlasPts, this.nucleoSprite);
    this.crearAnillos(comunidades.length);

    // Simulación: cada nodo se pliega hacia un punto de un brazo espiral de su comunidad, para que se forme una galaxia.
    const brazos = Math.max(2, comunidades.length);
    const objetivos = this.sim.map((s) => {
      if (s.c < 0) return { x: 0, z: 0 };
      const r = 55 + Math.pow(Math.random(), 0.8) * 360;
      const ang = (s.c / brazos) * Math.PI * 2 + r * 0.011 + (Math.random() - 0.5) * 0.55;
      return { x: Math.cos(ang) * r, z: Math.sin(ang) * r };
    });
    this.simulacion?.stop();
    const sim = forceSimulation(this.sim, this.ajustes.plano ? 2 : 3)
      .force('enlace', forceLink(lazos).id((d: Sim) => d.id).distance(14).strength(0.55))
      .force('carga', forceManyBody().strength(-30).distanceMax(300))
      .force('espiral', () => {
        const alfa = (this.simulacion?.alpha() ?? 0.3) * 0.06 + 0.022;
        this.sim.forEach((s, i) => {
          if (s.c < 0) return;
          const o = objetivos[i]!;
          s.vx += (o.x - s.x) * alfa;
          s.vz += (o.z - s.z) * alfa;
          s.vy += (0 - s.y) * 0.05;
        });
      })
      .alphaDecay(0.012)
      .stop();
    this.simulacion = sim;
    this.ticks = 0;
    this.radio = 430;
    this.reiniciarVista();
  }

  private nucleoSprite: THREE.Sprite | undefined;

  /** El centro luminoso de la referencia: un sprite con degradado, sin el límite de tamaño de los puntos. */
  private crearNucleo(): THREE.Sprite {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.28, 'rgba(255,255,255,0.95)');
    grad.addColorStop(0.5, 'rgba(255,255,255,0.35)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 256);
    const m = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    const sp = new THREE.Sprite(m);
    sp.scale.set(170, 170, 1);
    return sp;
  }

  private lazosSim: { source: string | Sim; target: string | Sim }[] = [];

  private crearAnillos(n: number): void {
    for (const o of [...this.anillosObj.children]) {
      this.anillosObj.remove(o);
      (o as THREE.Line).geometry.dispose();
    }
    for (let i = 0; i < Math.min(8, Math.max(3, n)); i++) {
      const r = 120 + i * 62;
      const pts: THREE.Vector3[] = [];
      for (let k = 0; k <= 160; k++) pts.push(new THREE.Vector3(Math.cos((k / 160) * 6.2832) * r, 0, Math.sin((k / 160) * 6.2832) * r));
      this.anillosObj.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false })));
    }
  }

  private crearEstrellas(): void {
    const N = 2200;
    const p = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const r = 900 + Math.random() * 900;
      const u = Math.random() * 6.2832;
      const v = Math.acos(2 * Math.random() - 1);
      p.set([r * Math.sin(v) * Math.cos(u), r * Math.cos(v), r * Math.sin(v) * Math.sin(u)], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    this.estrellasPts = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0.55, depthWrite: false }));
    this.escena.add(this.estrellasPts);
  }

  // ---------- ajustes ----------

  aplicarAjustes(parcial: Partial<Ajustes> = {}): void {
    const antesPlano = this.ajustes.plano;
    const antesColor = this.ajustes.color;
    this.ajustes = { ...this.ajustes, ...parcial };
    const a = this.ajustes;
    const dpr = window.devicePixelRatio || 1;
    this.renderer.setPixelRatio(a.calidad === 'rapida' ? 1 : a.calidad === 'alta' ? Math.min(dpr, 1.5) : Math.min(dpr, 2));
    this.bloom.enabled = a.calidad !== 'rapida';
    this.bloom.strength = 0.12 + a.brillo * 0.2;
    this.bloom.radius = 0.2 + a.tamBrillo * 0.4;
    this.estrellasPts.visible = a.estrellas;
    this.nucleoSprite?.scale.setScalar(70 + a.tamBrillo * 130);
    this.anillosObj.children.forEach((o) => ((o as THREE.Line).material as THREE.LineBasicMaterial).opacity = a.anillos * 1.6);
    this.anillosObj.visible = a.anillos > 0.01;
    if (this.puntos) {
      for (const m of [this.puntos.material, this.perlasPts.material] as THREE.ShaderMaterial[]) {
        m.uniforms.uBrillo!.value = a.brillo;
        m.uniforms.uHalo!.value = a.tamBrillo;
        m.uniforms.uPulso!.value = a.pulso ? 1 : 0;
      }
      (this.puntos.material as THREE.ShaderMaterial).uniforms.uTam!.value = 0.5 + a.tamNodo * 2.4;
      (this.perlasPts.material as THREE.ShaderMaterial).uniforms.uTam!.value = 1;
      (this.lineas.material as THREE.LineBasicMaterial).opacity = 0.07 * a.enlaces;
      if (a.color !== antesColor) this.recolorear();
    }
    this.controles.autoRotate = a.giro > 0;
    this.controles.autoRotateSpeed = a.giro * 0.35;
    this.controles.enableRotate = !a.plano;
    this.etiquetas.style.display = a.nombres ? 'block' : 'none';
    if (a.plano !== antesPlano && this.sim.length > 0) this.reconstruir();
    this.ajustarTamano();
  }

  private recolorear(): void {
    const base = new THREE.Color(this.ajustes.color);
    this.sim.forEach((s, i) => {
      if (s.id === NUCLEO) return;
      const c = base.clone().lerp(new THREE.Color('#9fb4c8'), (s.c % 5) / 12);
      this.coloresBase.set([c.r, c.g, c.b], i * 3);
    });
    this.colores.set(this.coloresBase);
    (this.puntos.geometry.getAttribute('col') as THREE.BufferAttribute).needsUpdate = true;
  }

  reiniciarVista(): void {
    const d = this.ajustes.plano ? new THREE.Vector3(0, this.radio * 2, 0.01) : new THREE.Vector3(0, this.radio * 0.9, this.radio * 1.7);
    this.vuelo = { desde: this.camara.position.clone(), hasta: d, t: 0 };
    this.controles.target.set(0, 0, 0);
  }

  enfocar(id?: string): void {
    const i = id ? this.indice.get(id) : this.elegido >= 0 ? this.elegido : this.hover;
    if (i === undefined || i < 0) return this.reiniciarVista();
    const s = this.sim[i]!;
    const objetivo = new THREE.Vector3(s.x, s.y, s.z);
    this.controles.target.copy(objetivo);
    this.vuelo = { desde: this.camara.position.clone(), hasta: objetivo.clone().add(new THREE.Vector3(0, 18, 46)), t: 0 };
  }

  elegir(id: string | null): void {
    this.elegido = id ? (this.indice.get(id) ?? -1) : -1;
    this.pintarVecindad(this.elegido >= 0 ? this.elegido : this.hover);
  }

  // ---------- interacción ----------

  private px(e: PointerEvent): { x: number; y: number } {
    const r = this.dom.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private masCercano(x: number, y: number): number {
    const r = this.dom.getBoundingClientRect();
    let mejor = -1;
    let d2 = 18 * 18;
    const v = new THREE.Vector3();
    for (let i = 0; i < this.nodos.length; i++) {
      const s = this.sim[i]!;
      v.set(s.x, s.y, s.z).project(this.camara);
      if (v.z > 1) continue;
      const sx = (v.x * 0.5 + 0.5) * r.width;
      const sy = (-v.y * 0.5 + 0.5) * r.height;
      const d = (sx - x) ** 2 + (sy - y) ** 2;
      if (d < d2) {
        d2 = d;
        mejor = i;
      }
    }
    return mejor;
  }

  private moverPuntero = (e: PointerEvent): void => {
    const { x, y } = this.px(e);
    const i = this.masCercano(x, y);
    if (i !== this.hover) {
      this.hover = i;
      this.pintarVecindad(i >= 0 ? i : this.elegido);
    }
    this.dom.style.cursor = i >= 0 ? 'pointer' : 'crosshair';
    this.alPasar(i >= 0 ? this.nodos[i]! : null, x, y);
  };

  private clic = (): void => {
    this.elegido = this.hover;
    this.alElegir(this.hover >= 0 ? this.nodos[this.hover]! : null);
  };

  /** Como en Obsidian: lo que toca el nodo bajo el cursor se enciende en morado. */
  private pintarVecindad(i: number): void {
    if (!this.puntos) return;
    this.colores.set(this.coloresBase);
    const pos: number[] = [];
    if (i >= 0) {
      const vec = this.ady.get(i) ?? [];
      for (const j of [i, ...vec]) this.colores.set([MORADO.r, MORADO.g, MORADO.b], j * 3);
      for (const j of vec) {
        const a = this.sim[i]!;
        const b = this.sim[j]!;
        pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
      }
    }
    this.vecinosResaltados = pos.length > 0 ? { i, vec: this.ady.get(i) ?? [] } : undefined;
    (this.puntos.geometry.getAttribute('col') as THREE.BufferAttribute).needsUpdate = true;
    this.resaltadas.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  }
  private vecinosResaltados: { i: number; vec: number[] } | undefined;

  // ---------- bucle ----------

  private ajustarTamano(): void {
    const w = this.contenedor.clientWidth;
    const h = this.contenedor.clientHeight;
    if (w === 0 || h === 0) return;
    this.renderer.setSize(w, h, false);
    this.dom.style.width = '100%';
    this.dom.style.height = '100%';
    this.compositor.setPixelRatio(this.renderer.getPixelRatio());
    this.compositor.setSize(w, h);
    this.camara.aspect = w / h;
    this.camara.updateProjectionMatrix();
    if (this.puntos) {
      const escala = (h * this.renderer.getPixelRatio()) / (2 * Math.tan((this.camara.fov * Math.PI) / 360));
      (this.puntos.material as THREE.ShaderMaterial).uniforms.uEscala!.value = escala;
      (this.perlasPts.material as THREE.ShaderMaterial).uniforms.uEscala!.value = escala;
    }
  }

  private visibilidad = (): void => {
    this.oculto = document.hidden && this.ajustes.ahorrarGpu;
  };

  private cuadro = (): void => {
    this.raf = requestAnimationFrame(this.cuadro);
    if (this.oculto) return;
    const dt = Math.min(this.reloj.getDelta(), 0.05);
    const t = this.reloj.elapsedTime;
    if (this.puntos) this.actualizar(dt, t);
    this.controles.update();
    this.compositor.render();
    this.fps.n++;
    const ahora = performance.now();
    if (ahora - this.fps.t >= 1000) {
      this.alFps(Math.round((this.fps.n * 1000) / (ahora - this.fps.t)));
      this.fps = { n: 0, t: ahora };
    }
    if (this.ajustes.nombres) this.ubicarEtiquetas();
  };

  private actualizar(dt: number, t: number): void {
    const sim = this.simulacion;
    if (sim && this.ticks < 420) {
      for (let k = 0; k < 4; k++) sim.tick();
      this.ticks += 4;
    }
    const pos = (this.puntos.geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
    this.sim.forEach((s, i) => pos.set([s.x, this.ajustes.plano ? 0 : s.y, s.z], i * 3));
    (this.puntos.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;

    const lp = (this.lineas.geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
    this.lazosSim.forEach((l, i) => {
      const a = typeof l.source === 'object' ? l.source : this.sim[this.indice.get(l.source) ?? 0]!;
      const b = typeof l.target === 'object' ? l.target : this.sim[this.indice.get(l.target) ?? 0]!;
      lp.set([a.x, this.ajustes.plano ? 0 : a.y, a.z, b.x, this.ajustes.plano ? 0 : b.y, b.z], i * 6);
    });
    (this.lineas.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;

    if (this.vecinosResaltados) {
      const { i, vec } = this.vecinosResaltados;
      const rp = (this.resaltadas.geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
      vec.forEach((j, k) => {
        const a = this.sim[i]!;
        const b = this.sim[j]!;
        rp.set([a.x, a.y, a.z, b.x, b.y, b.z], k * 6);
      });
      (this.resaltadas.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    }

    // Perlas: avanzan por su enlace; las que sobran según el ajuste se ocultan en el origen del núcleo.
    const pp = (this.perlasPts.geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
    const vis = Math.min(this.perlaT.length, Math.round(this.ajustes.perlas));
    const rapidez = 0.045 * this.ajustes.velPerlas * dt * 6;
    for (let k = 0; k < this.perlaT.length; k++) {
      if (k >= vis) {
        pp.set([0, -99999, 0], k * 3);
        continue;
      }
      this.perlaT[k]! < 1 ? (this.perlaT[k] = this.perlaT[k]! + rapidez * this.perlaV[k]!) : ((this.perlaT[k] = 0), (this.perlaEnlace[k] = Math.floor(Math.random() * this.lazosSim.length)));
      const l = this.lazosSim[this.perlaEnlace[k]!];
      if (!l) continue;
      const a = typeof l.source === 'object' ? l.source : this.sim[this.indice.get(l.source) ?? 0]!;
      const b = typeof l.target === 'object' ? l.target : this.sim[this.indice.get(l.target) ?? 0]!;
      const f = this.perlaT[k]!;
      pp.set([a.x + (b.x - a.x) * f, (this.ajustes.plano ? 0 : a.y + (b.y - a.y) * f), a.z + (b.z - a.z) * f], k * 3);
    }
    (this.perlasPts.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    const tamP = (this.perlasPts.geometry.getAttribute('tam') as THREE.BufferAttribute).array as Float32Array;
    for (let k = 0; k < tamP.length; k++) tamP[k] = k % 22 === 0 ? (this.ajustes.cometas ? 10 : 0) : 3;
    (this.perlasPts.geometry.getAttribute('tam') as THREE.BufferAttribute).needsUpdate = true;
    (this.puntos.material as THREE.ShaderMaterial).uniforms.uTiempo!.value = t;

    if (this.vuelo) {
      this.vuelo.t = Math.min(1, this.vuelo.t + dt * 1.6);
      const e = 1 - (1 - this.vuelo.t) ** 3;
      this.camara.position.lerpVectors(this.vuelo.desde, this.vuelo.hasta, e);
      if (this.vuelo.t >= 1) this.vuelo = undefined;
    }
  }

  /** Las comunidades más grandes llevan etiqueta; con cientos de comunidades, más sería ruido. */
  private principales: number[] = [];

  private ubicarEtiquetas(): void {
    if (this.sim.length === 0) return;
    for (const c of this.centrosCom) c.x = c.y = c.z = c.n = 0;
    this.sim.forEach((s) => {
      if (s.c < 0) return;
      const c = this.centrosCom[s.c]!;
      c.x += s.x;
      c.y += s.y;
      c.z += s.z;
      c.n++;
    });
    if (this.principales.length === 0) {
      this.principales = this.centrosCom.map((c, i) => ({ i, n: c.n })).sort((x, y) => y.n - x.n).slice(0, 14).map((x) => x.i);
    }
    if (this.etiquetas.childElementCount !== this.principales.length) {
      this.etiquetas.replaceChildren(
        ...this.principales.map((i) => {
          const el = document.createElement('span');
          el.className = 'etiqueta-carpeta';
          const nombre = this.centrosCom[i]!.nombre;
          el.textContent = nombre.length > 26 ? `${nombre.slice(0, 25)}…` : nombre;
          return el;
        }),
      );
    }
    const r = this.dom.getBoundingClientRect();
    const v = new THREE.Vector3();
    this.principales.forEach((ci, k) => {
      const c = this.centrosCom[ci]!;
      const el = this.etiquetas.children[k] as HTMLElement | undefined;
      if (!el) return;
      if (c.n === 0) return void (el.style.display = 'none');
      v.set(c.x / c.n, c.y / c.n, c.z / c.n).project(this.camara);
      const visible = v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05;
      el.style.display = visible ? 'block' : 'none';
      el.style.transform = `translate(${(v.x * 0.5 + 0.5) * r.width}px, ${(-v.y * 0.5 + 0.5) * r.height}px) translate(-50%, -50%)`;
    });
  }

  estadisticas(): { nodos: number; enlaces: number } {
    return { nodos: this.nodos.length, enlaces: this.enlaces.length };
  }

  destruir(): void {
    cancelAnimationFrame(this.raf);
    this.observador.disconnect();
    this.dom.removeEventListener('pointermove', this.moverPuntero);
    this.dom.removeEventListener('click', this.clic);
    document.removeEventListener('visibilitychange', this.visibilidad);
    this.simulacion?.stop();
    this.controles.dispose();
    this.compositor.dispose();
    this.renderer.dispose();
    this.dom.remove();
  }
}
