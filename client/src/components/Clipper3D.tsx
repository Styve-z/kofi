import { useEffect, useRef } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

/**
 * Tondeuse de barbier en 3D (Three.js), entièrement modélisée en code : aucun fichier 3D à télécharger.
 * Effets : flottement, inclinaison qui suit la souris / le doigt, lame qui vibre, mèches de cheveux projetées.
 * Un clic (ou appui) allume / éteint le moteur. Respecte « réduire les animations » (image fixe),
 * se met en pause hors écran, et ne s’affiche pas si WebGL est indisponible.
 */

const GOLD = new THREE.MeshPhysicalMaterial({ color: 0xc9844f, metalness: 1, roughness: 0.26, clearcoat: 0.6 }); // cuivre
const STEEL = new THREE.MeshPhysicalMaterial({ color: 0xdfe3e6, metalness: 1, roughness: 0.18 });
const DARK_STEEL = new THREE.MeshPhysicalMaterial({ color: 0x8d949a, metalness: 1, roughness: 0.32 });
const BODY = new THREE.MeshPhysicalMaterial({ color: 0x141c2e, metalness: 0.35, roughness: 0.38, clearcoat: 1, clearcoatRoughness: 0.18 });
const ACCENT = new THREE.MeshPhysicalMaterial({ color: 0xd08a52, metalness: 0.1, roughness: 0.35, clearcoat: 0.8 });
const CORD = new THREE.MeshStandardMaterial({ color: 0x151211, roughness: 0.55 });
const HAIR = new THREE.MeshStandardMaterial({ color: 0x2b1b14, roughness: 0.8 });

function logoTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 96;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#e3a878";
  ctx.font = "700 64px Fraunces, Georgia, serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("KOFI", 128, 52);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function shadowTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, "rgba(30,15,8,0.45)");
  gradient.addColorStop(1, "rgba(30,15,8,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}

/** Lame dentée : une barre + une rangée de dents. */
function blade(width: number, teeth: number, material: THREE.Material, toothHeight: number) {
  const group = new THREE.Group();
  const bar = new THREE.Mesh(new RoundedBoxGeometry(width, 0.07, 0.36, 2, 0.02), material);
  group.add(bar);
  const toothGeo = new THREE.BoxGeometry(0.034, toothHeight, 0.3);
  toothGeo.translate(0, toothHeight / 2, 0);
  const step = (width - 0.06) / (teeth - 1);
  for (let i = 0; i < teeth; i++) {
    const tooth = new THREE.Mesh(toothGeo, material);
    tooth.position.set(-width / 2 + 0.03 + i * step, 0.03, 0);
    group.add(tooth);
  }
  return group;
}

function buildClipper(logo: THREE.Texture) {
  const clipper = new THREE.Group();

  // Corps : profil tourné (poignée galbée), aplati en profondeur.
  const shell = new THREE.Group();
  shell.scale.set(1, 1, 0.64);
  const profile = [
    [0, -1.62], [0.34, -1.6], [0.47, -1.5], [0.52, -1.2], [0.55, -0.6], [0.6, 0], [0.66, 0.5], [0.72, 0.92], [0.7, 1.02], [0, 1.04],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  shell.add(new THREE.Mesh(new THREE.LatheGeometry(profile, 64), BODY));
  // Bagues dorées : bas, haut, et une zone striée pour la prise en main.
  const ring = (radius: number, y: number, tube = 0.035, material: THREE.Material = GOLD) => {
    const mesh = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 12, 64), material);
    mesh.rotation.x = Math.PI / 2;
    mesh.position.y = y;
    shell.add(mesh);
  };
  ring(0.49, -1.45, 0.045);
  ring(0.71, 0.95, 0.05);
  for (let i = 0; i < 7; i++) ring(0.53 + i * 0.004, -1.05 + i * 0.09, 0.018, DARK_STEEL);
  clipper.add(shell);

  // Tête : bloc métallique qui porte les lames.
  const head = new THREE.Mesh(new RoundedBoxGeometry(1.5, 0.42, 0.56, 4, 0.1), GOLD);
  head.position.y = 1.2;
  clipper.add(head);

  const fixedBlade = blade(1.56, 24, STEEL, 0.17);
  fixedBlade.position.set(0, 1.45, -0.03);
  clipper.add(fixedBlade);
  const movingBlade = blade(1.42, 22, DARK_STEEL, 0.12);
  movingBlade.position.set(0, 1.44, 0.07);
  clipper.add(movingBlade);

  // Levier de réglage (sur le côté de la tête).
  const pivot = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.08, 24), DARK_STEEL);
  pivot.rotation.z = Math.PI / 2;
  pivot.position.set(0.79, 1.18, 0);
  clipper.add(pivot);
  const lever = new THREE.Mesh(new RoundedBoxGeometry(0.06, 0.62, 0.12, 2, 0.03), GOLD);
  lever.position.set(0.84, 0.92, 0.06);
  lever.rotation.z = 0.22;
  clipper.add(lever);

  // Interrupteur orange + logo gravé sur la face avant.
  const front = 0.6 * 0.64;
  const switchBase = new THREE.Mesh(new RoundedBoxGeometry(0.26, 0.5, 0.08, 3, 0.035), DARK_STEEL);
  switchBase.position.set(0, 0.2, front + 0.005);
  clipper.add(switchBase);
  const switchKnob = new THREE.Mesh(new RoundedBoxGeometry(0.18, 0.2, 0.1, 3, 0.04), ACCENT);
  switchKnob.position.set(0, 0.3, front + 0.05);
  clipper.add(switchKnob);
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.035, 16, 16), new THREE.MeshBasicMaterial({ color: 0x7dffb2 }));
  led.position.set(0, -0.12, front + 0.02);
  clipper.add(led);
  const logoPlane = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.23), new THREE.MeshBasicMaterial({ map: logo, transparent: true }));
  logoPlane.position.set(0, -0.48, 0.56 * 0.64 + 0.012);
  clipper.add(logoPlane);

  // Cordon qui sort par le bas.
  const cordPath = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, -1.6, 0), new THREE.Vector3(0, -1.95, 0.05), new THREE.Vector3(-0.35, -2.35, 0.2),
    new THREE.Vector3(-1.1, -2.45, 0.1), new THREE.Vector3(-1.9, -2.2, -0.2), new THREE.Vector3(-2.6, -2.5, -0.4),
  ]);
  clipper.add(new THREE.Mesh(new THREE.TubeGeometry(cordPath, 80, 0.055, 12, false), CORD));
  const strain = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.14, 0.32, 24), CORD);
  strain.position.y = -1.74;
  clipper.add(strain);

  return { clipper, movingBlade, led };
}

/** Mèches de cheveux projetées par la lame (instances recyclées). */
function createHair(count: number) {
  const geometry = new THREE.CylinderGeometry(0.008, 0.008, 0.16, 4);
  const mesh = new THREE.InstancedMesh(geometry, HAIR, count);
  mesh.frustumCulled = false;
  const particles = Array.from({ length: count }, () => ({ pos: new THREE.Vector3(), vel: new THREE.Vector3(), rot: new THREE.Euler(), spin: new THREE.Vector3(), life: 0, max: 1 }));
  return { mesh, particles };
}

export default function Clipper3D({ className }: { className?: string }) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
    } catch {
      return; // pas de WebGL : on garde le visuel d’origine
    }
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.domElement.style.display = "block";
    renderer.domElement.style.cursor = "pointer";
    renderer.domElement.setAttribute("aria-hidden", "true");
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envMap;

    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
    camera.position.set(0, 0.2, 9.2);

    scene.add(new THREE.HemisphereLight(0xf4f2ee, 0x2a426e, 0.9));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(3, 4, 5);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xd08a52, 2.4);
    rim.position.set(-4, 2, -3);
    scene.add(rim);

    const logo = logoTexture();
    const shadowTex = shadowTexture();
    const { clipper, movingBlade, led } = buildClipper(logo);
    const rig = new THREE.Group(); // le rig gère flottement + souris, la tondeuse garde sa pose
    clipper.rotation.z = -0.38;
    clipper.rotation.x = 0.12;
    rig.add(clipper);
    scene.add(rig);

    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 1.2), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = -2.75;
    scene.add(shadow);

    const HAIR_COUNT = 140;
    const hair = createHair(HAIR_COUNT);
    scene.add(hair.mesh);
    const dummy = new THREE.Object3D();
    const bladeTip = new THREE.Vector3();
    const bladeDir = new THREE.Vector3();
    for (let i = 0; i < HAIR_COUNT; i++) { dummy.scale.setScalar(0); dummy.updateMatrix(); hair.mesh.setMatrixAt(i, dummy.matrix); }

    const resize = () => {
      const { width, height } = host.getBoundingClientRect();
      if (!width || !height) return;
      renderer.setSize(width, height, false);
      renderer.domElement.style.width = `${width}px`;
      renderer.domElement.style.height = `${height}px`;
      camera.aspect = width / height;
      // Cadrage : on recule la caméra sur les zones étroites pour garder la tondeuse entière.
      camera.position.z = camera.aspect < 0.75 ? (9.2 * 0.75) / Math.max(camera.aspect, 0.45) : 9.2;
      camera.updateProjectionMatrix();
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(host);
    resize();

    // Souris / doigt : inclinaison douce vers le pointeur.
    const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
    const onPointerMove = (event: PointerEvent) => {
      const rect = host.getBoundingClientRect();
      pointer.tx = THREE.MathUtils.clamp(((event.clientX - rect.left) / rect.width) * 2 - 1, -1.5, 1.5);
      pointer.ty = THREE.MathUtils.clamp(((event.clientY - rect.top) / rect.height) * 2 - 1, -1.5, 1.5);
    };
    window.addEventListener("pointermove", onPointerMove, { passive: true });

    let motorOn = true;
    let burst = 0;
    const onClick = () => {
      motorOn = !motorOn;
      if (motorOn) burst = 40;
      (led.material as THREE.MeshBasicMaterial).color.set(motorOn ? 0x7dffb2 : 0x3a3a3a);
    };
    renderer.domElement.addEventListener("click", onClick);

    let spawnIndex = 0;
    const spawn = () => {
      const p = hair.particles[spawnIndex];
      spawnIndex = (spawnIndex + 1) % HAIR_COUNT;
      // Point de départ : le long des dents de la lame, dans le repère du monde.
      bladeTip.set((Math.random() - 0.5) * 1.4, 1.62, 0.1);
      clipper.localToWorld(bladeTip);
      bladeDir.set((Math.random() - 0.5) * 1.2, 1, 0.3 + Math.random() * 0.5).applyQuaternion(clipper.getWorldQuaternion(new THREE.Quaternion())).normalize();
      p.pos.copy(bladeTip);
      p.vel.copy(bladeDir).multiplyScalar(1.6 + Math.random() * 1.8);
      p.rot.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      p.spin.set((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12);
      p.max = 1.1 + Math.random() * 0.9;
      p.life = p.max;
    };

    const clock = new THREE.Clock();
    let running = true;
    let visible = true;
    let frame = 0;
    let spawnAcc = 0;

    const render = () => {
      const dt = Math.min(clock.getDelta(), 0.05);
      const t = clock.elapsedTime;

      pointer.x += (pointer.tx - pointer.x) * 0.06;
      pointer.y += (pointer.ty - pointer.y) * 0.06;
      rig.position.y = Math.sin(t * 1.3) * 0.12;
      rig.rotation.y = Math.sin(t * 0.45) * 0.55 + pointer.x * 0.55;
      rig.rotation.x = pointer.y * 0.28;
      shadow.scale.setScalar(1 - Math.sin(t * 1.3) * 0.06);

      if (motorOn) {
        movingBlade.position.x = Math.sin(t * 90) * 0.025; // va-et-vient de la lame
        clipper.position.x = (Math.random() - 0.5) * 0.008; // micro-vibration du moteur
        clipper.position.y = (Math.random() - 0.5) * 0.008;
        spawnAcc += dt * 38 + (burst > 0 ? 3 : 0);
        if (burst > 0) burst--;
        while (spawnAcc >= 1) { spawn(); spawnAcc -= 1; }
      } else {
        clipper.position.set(0, 0, 0);
      }

      for (let i = 0; i < HAIR_COUNT; i++) {
        const p = hair.particles[i];
        if (p.life <= 0) continue;
        p.life -= dt;
        p.vel.y -= 4.2 * dt;
        p.vel.multiplyScalar(1 - 0.8 * dt);
        p.pos.addScaledVector(p.vel, dt);
        p.rot.x += p.spin.x * dt; p.rot.y += p.spin.y * dt; p.rot.z += p.spin.z * dt;
        dummy.position.copy(p.pos);
        dummy.rotation.copy(p.rot);
        dummy.scale.setScalar(Math.max(0, Math.min(1, p.life / p.max * 2)));
        dummy.updateMatrix();
        hair.mesh.setMatrixAt(i, dummy.matrix);
      }
      hair.mesh.instanceMatrix.needsUpdate = true;

      renderer.render(scene, camera);
    };

    const loop = () => {
      frame = 0;
      if (!running || !visible) return;
      render();
      frame = requestAnimationFrame(loop);
    };
    const start = () => { if (!frame && running && visible && !reduceMotion) { clock.getDelta(); frame = requestAnimationFrame(loop); } };

    if (reduceMotion) {
      motorOn = false;
      render();
    } else {
      start();
    }

    // Pause quand le visuel sort de l’écran ou que l’onglet est caché.
    const intersection = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; if (visible) start(); });
    intersection.observe(host);
    const onVisibility = () => { running = !document.hidden; if (running) start(); };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelAnimationFrame(frame);
      running = false;
      intersection.disconnect();
      resizeObserver.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("click", onClick);
      scene.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (material && !Array.isArray(material) && ![GOLD, STEEL, DARK_STEEL, BODY, ACCENT, CORD, HAIR].includes(material as never)) material.dispose();
      });
      logo.dispose();
      shadowTex.dispose();
      envMap.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return <div ref={hostRef} className={className} />;
}
