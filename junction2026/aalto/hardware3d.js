// Plant the beginning: the lamp's electronics as built at Junction, in 3D.
// Every part and wire sits where it was wired: UNO Q, red mini breadboard with the
// three button modules and three TIP120s, DHT22 in A1-A3, Grove light sensor, buzzer,
// soil probe in the pot, and the 12 V RGB strip. Units are millimetres.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";

const host = document.getElementById("hw3d");
const tip = document.getElementById("hw3d-tip");
const moodButtons = [...document.querySelectorAll("[data-mood]")];
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---------------------------------------------------------------- scene
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
host.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(32, 1, 1, 3000);
camera.position.set(-6, 360, 470);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(-6, 78, -58);
controls.enableZoom = false;          // the page keeps scrolling; zoom with the + / − buttons
controls.enablePan = false;
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.47;
controls.minDistance = 120;
controls.maxDistance = 650;
controls.autoRotate = !reduceMotion;
controls.autoRotateSpeed = 0.6;

scene.add(new THREE.HemisphereLight(0xffffff, 0xa3b9cc, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(-120, 260, 160);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -260, right: 260, top: 260, bottom: -260, near: 10, far: 800 });
scene.add(sun);

const ground = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200), new THREE.ShadowMaterial({ opacity: 0.12 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// ---------------------------------------------------------------- helpers
// Plan coordinates: x right, y "back" (away from the viewer); h = height above the table.
const W = (x, y, h = 0) => new THREE.Vector3(x, h, -y);
const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.05, ...extra });
const M = {
  pcbQ: mat(0x1d2b33), pcbBlue: mat(0x1e5fa8), pcbGrove: mat(0x2a6fb5), black: mat(0x161616, { roughness: 0.45 }),
  hole: mat(0x2a1414), red: mat(0xd2232a, { roughness: 0.5 }), white: mat(0xf2f2ee), green: mat(0x1f9d55),
  metal: mat(0xc7ccd1, { metalness: 0.8, roughness: 0.3 }), gold: mat(0xd4b35a, { metalness: 0.7, roughness: 0.35 }),
  tip: mat(0x202020, { roughness: 0.35 }), dht: mat(0xf4f4f0, { roughness: 0.7 }), soil: mat(0x4a3324, { roughness: 1 }),
  pot: mat(0xc9b8a6, { roughness: 0.9 }), leaf: mat(0x3f8f4a, { roughness: 0.8 }), resistor: mat(0xd9c39a),
  strip: mat(0xf7f7f2, { roughness: 0.8 }), chip: mat(0x777777),
};
const parts = [];   // groups with { name, desc } for the hover labels
function part(name, desc) {
  const g = new THREE.Group();
  g.userData = { name, desc };
  scene.add(g);
  parts.push(g);
  return g;
}
function box(g, w, d, h, material, x, y, z, shadow = true) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.copy(W(x, y, z + h / 2));
  m.castShadow = shadow; m.receiveShadow = true;
  g.add(m);
  return m;
}
function cyl(g, r, h, material, x, y, z, seg = 32) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), material);
  m.position.copy(W(x, y, z + h / 2));
  m.castShadow = true; m.receiveShadow = true;
  g.add(m);
  return m;
}
const WIRE = { red: 0xd2232a, blue: 0x1f5fbf, white: 0xf4f4f0, green: 0x1f9d55, black: 0x161616, yellow: 0xe8c021 };
function wire(g, a, b, color, lift = 10, r = 0.55) {
  const dist = a.distanceTo(b);
  const up = lift + dist * 0.18;
  const c1 = a.clone().add(new THREE.Vector3(0, up, 0)).lerp(b, 0.15);
  const c2 = b.clone().add(new THREE.Vector3(0, up, 0)).lerp(a, 0.15);
  const curve = new THREE.CubicBezierCurve3(a, c1, c2, b);
  const m = new THREE.Mesh(new THREE.TubeGeometry(curve, 40, r, 8, false), mat(WIRE[color] ?? color, { roughness: 0.45 }));
  m.castShadow = true;
  g.add(m);
  // plug ends: a short vertical tip so wires look pushed into holes
  for (const p of [a, b]) {
    const pin = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.05, r * 1.05, 3, 8), m.material);
    pin.position.copy(p).add(new THREE.Vector3(0, 1.2, 0));
    g.add(pin);
  }
  return m;
}

// A wire along a set of points (used where a wire must go round something, like the pot's rim).
function wireVia(g, pts, color, r = 0.55) {
  const curve = new THREE.CatmullRomCurve3(pts, false, "centripetal");
  const m = new THREE.Mesh(new THREE.TubeGeometry(curve, 90, r, 8, false), mat(WIRE[color] ?? color, { roughness: 0.45 }));
  m.castShadow = true;
  g.add(m);
  const end = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.05, r * 1.05, 3, 8), m.material);
  end.position.copy(pts[pts.length - 1]).add(new THREE.Vector3(0, 1.2, 0));
  g.add(end);
  return m;
}

// ---------------------------------------------------------------- Arduino UNO Q
const UNO = { x0: -82, y0: -26.67, w: 68.58, d: 53.34, top: 4.6, hdr: 13.1 };
const unoPin = (x, y) => W(UNO.x0 + x, UNO.y0 + y, UNO.hdr);
const PINS = {};
["SCL", "SDA", "AREF", "GND_D", "D13", "D12", "D11", "D10", "D9", "D8"].forEach((n, i) => (PINS[n] = [17.526 + 2.54 * i, 50.8]));
["D7", "D6", "D5", "D4", "D3", "D2", "D1", "D0"].forEach((n, i) => (PINS[n] = [44.45 + 2.54 * i, 50.8]));
["NC", "IOREF", "RESET", "3V3", "5V", "GND1", "GND2", "VIN"].forEach((n, i) => (PINS[n] = [27.94 + 2.54 * i, 2.54]));
["A0", "A1", "A2", "A3", "A4", "A5"].forEach((n, i) => (PINS[n] = [50.8 + 2.54 * i, 2.54]));
const P = (n) => unoPin(...PINS[n]);

const uno = part("Arduino UNO Q (2 GB)", "The lamp's brain. Its microcontroller reads the buttons and sensors and drives the light; its Linux side runs the rhythm check, the learning loop and the link to the clinic view.");
box(uno, UNO.w, UNO.d, 1.6, M.pcbQ, UNO.x0 + UNO.w / 2, 0, 3);
for (const [sx, sy] of [[3, 3], [UNO.w - 3, 3], [3, UNO.d - 3], [UNO.w - 3, UNO.d - 3]]) cyl(uno, 1.6, 3, M.metal, UNO.x0 + sx, UNO.y0 + sy, 0, 12);
// female headers
const header = (x0, y, n) => box(uno, 2.54 * n, 2.6, 8.5, M.black, UNO.x0 + x0 - 1.27 + (2.54 * n) / 2, UNO.y0 + y, UNO.top);
header(17.526, 50.8, 10); header(44.45, 50.8, 8); header(27.94, 2.54, 8); header(50.8, 2.54, 6);
{
  const holes = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.2, 1), M.hole, Object.keys(PINS).length);
  let i = 0; const o = new THREE.Object3D();
  for (const n in PINS) { o.position.copy(P(n)).add(new THREE.Vector3(0, 0.05, 0)); o.updateMatrix(); holes.setMatrixAt(i++, o.matrix); }
  uno.add(holes);
}
box(uno, 9, 7.5, 3.2, M.metal, UNO.x0 + 2.5, UNO.y0 + 30, UNO.top);          // USB-C
box(uno, 12, 12, 1.2, M.chip, UNO.x0 + 22, UNO.y0 + 22, UNO.top);           // processor
box(uno, 7, 7, 1, M.chip, UNO.x0 + 36, UNO.y0 + 34, UNO.top);               // microcontroller
box(uno, 4.5, 3, 2, M.white, UNO.x0 + 5, UNO.y0 + 44, UNO.top);             // Qwiic
// 8 x 13 LED matrix: shows the mood digit in the mood's colour
const matrix = new THREE.InstancedMesh(new THREE.BoxGeometry(1.2, 0.6, 1.2), new THREE.MeshStandardMaterial({ color: 0x111111 }), 104);
{
  const o = new THREE.Object3D();
  for (let r = 0; r < 8; r++) for (let c = 0; c < 13; c++) {
    o.position.copy(W(UNO.x0 + 40 + c * 1.9, UNO.y0 + 12 + (7 - r) * 1.9, UNO.top + 0.3)); o.updateMatrix();
    matrix.setMatrixAt(r * 13 + c, o.matrix); matrix.setColorAt(r * 13 + c, new THREE.Color(0x222222));
  }
  uno.add(matrix);
}
const DIGITS = {
  1: ["010", "110", "010", "010", "111"], 2: ["111", "001", "111", "100", "111"], 3: ["111", "001", "111", "001", "111"],
  4: ["101", "101", "111", "001", "001"], 5: ["111", "100", "111", "001", "111"],
};

// ---------------------------------------------------------------- breadboard
const BB = { x: 32, w: 47, d: 35.5, h: 8.5 };
const hole = (col, half, row) => W(BB.x + (col - 9) * 2.54, (half === "top" ? -1 : 1) * (3.81 + 2.54 * row), BB.h);
const bb = part("Mini breadboard", "Joins everything without soldering. The five holes in a column are connected. Front half: the buttons and the 3.3 V and ground buses. Back half: the three TIP120 switches and the soil probe's resistor.");
box(bb, BB.w, BB.d, BB.h, M.red, BB.x, 0, 0);
box(bb, BB.w - 2, 2, 0.3, mat(0xa81c22), BB.x, 0, BB.h - 0.25, false);       // centre groove
{
  const holes = new THREE.InstancedMesh(new THREE.BoxGeometry(1.1, 0.25, 1.1), M.hole, 170);
  const o = new THREE.Object3D(); let i = 0;
  for (const half of ["top", "bottom"]) for (let c = 1; c <= 17; c++) for (let r = 0; r < 5; r++) {
    o.position.copy(hole(c, half, r)).add(new THREE.Vector3(0, 0.02, 0)); o.updateMatrix(); holes.setMatrixAt(i++, o.matrix);
  }
  bb.add(holes);
}

// ---------------------------------------------------------------- buttons (front half, facing the viewer)
const BUTTONS = [
  { cols: [1, 2, 3], cap: M.white, pin: "D2", wire: "white", name: "White button: +", desc: "Mood up while choosing. With the picker closed: the lamp's glow brighter." },
  { cols: [6, 7, 8], cap: M.black, pin: "D8", wire: "white", name: "Black button: −", desc: "Mood down while choosing. With the picker closed: dims the glow, down to off." },
  { cols: [11, 12, 13], cap: M.green, pin: "D11", wire: "green", name: "Green button: the daily mood update (core signal)", desc: "Opens the mood picker, then saves the mood: one question a day, and the moment the day really started. Hold 3 s to mark yourself away." },
];
const wiresGroup = part("Jumper wires", "Red is 3.3 V, blue is ground, white and green carry signals: the same colours as on the real build.");
BUTTONS.forEach((b, i) => {
  const g = part(b.name, b.desc);
  const cx = BB.x + (b.cols[1] - 9) * 2.54;
  box(g, 22, 1.6, 22, M.pcbBlue, cx, -18.5, BB.h + 1);                       // module board, upright
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, 7, 32), b.cap);
  cap.rotation.x = Math.PI / 2; cap.position.copy(W(cx, -23, BB.h + 12)); cap.castShadow = true; g.add(cap);
  box(g, 12, 4, 12, M.black, cx, -21, BB.h + 6);                              // switch body
  for (const c of b.cols) box(g, 0.64, 4, 0.64, M.gold, BB.x + (c - 9) * 2.54, -15.5, BB.h);   // right-angle pins
  // power, ground and signal
  wire(wiresGroup, hole(b.cols[0], "top", 2), hole(15, "top", 2 + i), "red", 4, 0.45);
  wire(wiresGroup, hole(b.cols[2], "top", 1), hole(16, "top", 2 + i), "blue", 3, 0.45);
  wire(wiresGroup, hole(b.cols[1], "top", 0), P(b.pin), b.wire, 18);
});
wire(wiresGroup, P("3V3"), hole(15, "top", 1), "red", 22);
wire(wiresGroup, P("GND1"), hole(16, "top", 1), "blue", 20);

// ---------------------------------------------------------------- TIP120s (back half)
const TIPS = [{ cols: [1, 2, 3], pin: "D5", ch: "red" }, { cols: [6, 7, 8], pin: "D9", ch: "green" }, { cols: [11, 12, 13], pin: "D10", ch: "blue" }];
const resistors = part("Resistors", "1 kΩ between each board pin and its TIP120, and 10 kΩ for the soil probe's reading.");
function resistor(a, b, bands) {
  const mid = a.clone().lerp(b, 0.5).add(new THREE.Vector3(0, 4, 0));
  const body = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 6, 16), M.resistor);
  body.position.copy(mid); body.rotation.z = Math.PI / 2;
  body.rotation.y = Math.atan2(-(b.z - a.z), b.x - a.x);
  body.castShadow = true; resistors.add(body);
  bands.forEach((col, i) => {
    const band = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.15, 0.6, 16), mat(col));
    band.position.set(-1.8 + i * 1.2, 0, 0).applyEuler(body.rotation).add(mid); band.rotation.copy(body.rotation); resistors.add(band);
  });
  for (const p of [a, b]) {
    const leg = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([p, p.clone().add(new THREE.Vector3(0, 4, 0)), mid]), 8, 0.25, 6), M.metal);
    resistors.add(leg);
  }
}
TIPS.forEach((t, i) => {
  const g = part(`TIP120 switch (${t.ch})`, `Switches the strip's ${t.ch} channel on and off thousands of times a second, so the 3.3 V board can dim a 12 V light.`);
  const cx = BB.x + (t.cols[1] - 9) * 2.54;
  box(g, 10, 4.5, 9, M.tip, cx, 3.81 + 1, BB.h + 5);                          // body
  const tab = box(g, 10, 1.3, 6.5, M.metal, cx, 3.81 + 2.9, BB.h + 14);       // metal tab
  const holeM = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.8, 1.5, 16), M.hole);
  holeM.rotation.x = Math.PI / 2; holeM.position.copy(W(cx, 3.81 + 2.9, BB.h + 17.5)); g.add(holeM);
  for (const c of t.cols) box(g, 0.8, 0.5, 5, M.metal, BB.x + (c - 9) * 2.54, 3.81, BB.h);
  resistor(hole(t.cols[0], "bottom", 1), hole(t.cols[0] + 3, "bottom", 1), [0x6b3f1f, 0x111111, 0xd2232a]);
  wire(wiresGroup, P(t.pin), hole(t.cols[0] + 3, "bottom", 2), "white", 16);
  wire(wiresGroup, hole(t.cols[2], "bottom", 2), hole(15, "bottom", 2 + i), "blue", 3, 0.45);
});
wire(wiresGroup, hole(16, "bottom", 3), hole(15, "bottom", 1), "blue", 2, 0.45);

// ---------------------------------------------------------------- DHT22 in A1, A2, A3
const dht = part("DHT22 temperature and humidity (extra)", "A nice smart-home reading of the room, shown in the clinic view but not used to flag anyone. Plugged straight into A1, A2 and A3; in the lamp it sits in the outside pocket.");
{
  const x = UNO.x0 + PINS.A2[0];
  box(dht, 15, 1.6, 20, M.black, x, UNO.y0 + 2.54 - 3, UNO.hdr + 3);
  box(dht, 15.1, 7.7, 20, M.dht, x, UNO.y0 + 2.54 - 7.5, UNO.hdr + 6);
  for (let k = 0; k < 4; k++) for (let j = 0; j < 3; j++) box(dht, 2, 0.3, 2, mat(0xbdbdb8), x - 4 + j * 4, UNO.y0 + 2.54 - 11.5, UNO.hdr + 9 + k * 4, false);
  for (const n of ["A1", "A2", "A3"]) box(dht, 0.64, 0.64, 6, M.gold, UNO.x0 + PINS[n][0], UNO.y0 + 2.54, UNO.hdr - 3);
}

// ---------------------------------------------------------------- Grove light sensor
const grove = part("Light sensor: daylight in the room (core signal)", "How much daylight gets in and when the room gets bright. Did the person open the curtains and switch the lights on, or answer the mood question and go back to bed in the dark?");
{
  const gx = -112, gy = 60;
  box(grove, 20, 20, 1.6, M.pcbGrove, gx, gy, 0);
  box(grove, 4, 4, 1.5, M.chip, gx, gy + 3, 1.6);
  box(grove, 8, 5, 5, M.white, gx, gy - 8, 1.6);
  const plug = W(gx, gy - 11, 4);
  const ends = [["red", hole(15, "top", 0)], ["blue", P("GND_D")], ["white", P("SDA")], ["green", P("SCL")]];
  ends.forEach(([c, to], i) => wire(wiresGroup, plug.clone().add(new THREE.Vector3(-1.5 + i, 0, 0)), to, c, 20 + i * 2, 0.45));
}

// ---------------------------------------------------------------- buzzer
const buzzer = part("Piezo buzzer (supporting)", "The chime: a rising tone for +, a falling one for −, a soft two-note chime when a mood is saved, and the morning wake cue.");
{
  const bx = -112, by = 22;
  cyl(buzzer, 15, 9, M.black, bx, by, 0, 40);
  box(buzzer, 44, 7, 1.5, M.black, bx, by, 0);
  cyl(buzzer, 2.5, 0.4, mat(0x6b5a3a), bx, by, 9, 20);
  const out = W(bx + 14, by - 4, 6);
  wire(wiresGroup, out, P("D3"), "red", 22, 0.4);
  wire(wiresGroup, out.clone().add(new THREE.Vector3(1, 0, 1)), hole(16, "top", 0), "black", 26, 0.4);
}

// ---------------------------------------------------------------- the 3D-printed planter, the plant, and the strip round the sleeve's inner rim
// The real print files (dawn-planter.scad): bottom plate, base with the light window, and the
// ocean-wave sleeve that holds the plant's own nursery pot. Sizes in mm, from the .scad file.
const LAMP = { x: -8, y: 132, baseH: 66, sleeveFloor: 2.4, potFeet: 6, potH: 88, potTop: 52.5, potBot: 42, cavityR: 54.5, sleeveR: 56.3 };
LAMP.sleeveTop = LAMP.baseH + LAMP.sleeveFloor + LAMP.potFeet + LAMP.potH + 2;          // 164.4
LAMP.potZ = LAMP.baseH + LAMP.sleeveFloor + LAMP.potFeet;                                 // nursery pot floor
LAMP.soil = LAMP.potZ + LAMP.potH - 12;
const planter = part("The 3D-printed planter", "Designed for this lamp: a base for the electronics with a light window, and a wave sleeve round the plant's own pot. The waves are brain waves, and aalto is Finnish for wave.");
{
  // OpenSCAD is z-up; this group turns it to the scene's y-up, so the .scad x/y are the plan x/y.
  const g = new THREE.Group();
  g.rotation.x = -Math.PI / 2;
  g.position.copy(W(LAMP.x, LAMP.y, 0));
  planter.add(g);
  const PRINTS = [
    { file: "bottom", color: 0x9aa3a8, z: -2.4 },
    { file: "base", color: 0xe9e7e1, z: LAMP.baseH, flip: true },          // printed upside down
    { file: "sleeve", color: 0xf7f6f1, z: LAMP.baseH },
    { file: "window", color: 0xfff1c9, z: 17, x: 10, y: -69, front: true, opacity: 0.85 },
  ];
  const loader = new STLLoader();
  for (const pr of PRINTS) {
    loader.load(`models/${pr.file}.stl`, (geo) => {
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, mat(pr.color, { roughness: 0.75, side: THREE.DoubleSide, transparent: !!pr.opacity, opacity: pr.opacity ?? 1 }));
      if (pr.flip) m.rotation.x = Math.PI;
      if (pr.front) m.rotation.x = -Math.PI / 2;
      m.position.set(pr.x || 0, pr.y || 0, pr.z);
      m.castShadow = true; m.receiveShadow = true;
      g.add(m);
      requestRender();
    });
  }
}
const lampR = (z) => LAMP.potBot + (LAMP.potTop - LAMP.potBot) * ((z - LAMP.potZ) / LAMP.potH);   // nursery pot radius
const pot = part("Plant and soil probe: watering (core signal)", "Notices each watering. Caring for something living is a sign of care for oneself, of energy and of being up and active; a plant left dry for days says something too. Two bare wires in the soil: wet soil lets more of a tiny current through.");
{
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(LAMP.potTop, LAMP.potBot, LAMP.potH, 72, 1, true), mat(0x2b2b2b, { roughness: 0.7, side: THREE.DoubleSide }));
  wall.position.copy(W(LAMP.x, LAMP.y, LAMP.potZ + LAMP.potH / 2)); pot.add(wall);
  cyl(pot, lampR(LAMP.soil) - 0.5, 1.2, M.soil, LAMP.x, LAMP.y, LAMP.soil - 1.2, 72);
  for (let k = 0; k < 13; k++) {
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(13, 18, 12), M.leaf);
    const a = (k / 13) * Math.PI * 2;
    leaf.scale.set(0.5, 2.2, 0.22);
    leaf.position.copy(W(LAMP.x + Math.cos(a) * 14, LAMP.y + Math.sin(a) * 14, LAMP.soil + 28 + (k % 3) * 9));
    leaf.rotation.set(Math.sin(a) * 0.55, -a, Math.cos(a) * 0.55);
    leaf.castShadow = true; pot.add(leaf);
  }
  const front = -Math.PI / 2 - 0.3;                     // the side facing the electronics
  const at = (a, r, h) => W(LAMP.x + Math.cos(a) * r, LAMP.y + Math.sin(a) * r, h);
  const probeA = at(front, 34, LAMP.soil), probeB = at(front + 0.22, 34, LAMP.soil);
  for (const p of [probeA, probeB]) {
    const tipM = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 20, 8), M.metal);
    tipM.position.copy(p).add(new THREE.Vector3(0, -8, 0)); pot.add(tipM);
  }
  // Probe wires: up out of the soil, over the sleeve's rim, down its outside and over the base, then to the board.
  const overRim = (p, a, to, lift) => [
    p, p.clone().add(new THREE.Vector3(0, 12, 0)), at(a, LAMP.cavityR - 3, LAMP.sleeveTop + 8), at(a, LAMP.sleeveR + 5, LAMP.sleeveTop + 5),
    at(a, LAMP.sleeveR + 6, LAMP.baseH + 30), at(a, LAMP.sleeveR + 8, LAMP.baseH + 4), at(a, 80, LAMP.baseH - 6), at(a, 84, 6),
    to.clone().lerp(at(a, 84, 6), 0.4).add(new THREE.Vector3(0, lift, 0)), to.clone().add(new THREE.Vector3(0, 6, 0)), to];
  wireVia(wiresGroup, overRim(probeA, front, P("D4"), 22), "white");
  wireVia(wiresGroup, overRim(probeB, front + 0.22, hole(17, "bottom", 3), 16), "green");
  wire(wiresGroup, P("A0"), hole(17, "bottom", 1), "green", 18);
  wire(wiresGroup, P("GND2"), hole(16, "bottom", 1), "blue", 20);
  resistor(hole(16, "bottom", 2), hole(17, "bottom", 2), [0x6b3f1f, 0x111111, 0xe07b00]);
}

const strip = part("12 V RGB LED strip on the inner rim (supporting)", "The light that answers: the mood's colour while choosing, a soft glow afterwards, and the morning sunrise. It lines the sleeve's inner rim, so the plant itself glows.");
const ledMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffaa55, emissiveIntensity: 1.6 });
const glowMat = new THREE.MeshBasicMaterial({ color: 0xffaa55, transparent: true, opacity: 0.35, depthWrite: false });
const stripLight = new THREE.PointLight(0xffaa55, 0, 300, 1.6);
const STRIP_H = LAMP.sleeveTop - 5;
const plugAngle = Math.atan2(0 - LAMP.y, BB.x - LAMP.x);
const plugAt = (k) => W(LAMP.x + Math.cos(plugAngle) * (LAMP.sleeveR + 6), LAMP.y + Math.sin(plugAngle) * (LAMP.sleeveR + 6) + (k - 1.5) * 1.6, LAMP.sleeveTop + 2);
{
  const rIn = LAMP.cavityR - 0.6;
  const band = new THREE.Mesh(new THREE.CylinderGeometry(rIn, rIn, 10, 72, 1, true), mat(0xf7f7f2, { roughness: 0.8, side: THREE.DoubleSide }));
  band.position.copy(W(LAMP.x, LAMP.y, STRIP_H)); strip.add(band);
  const n = Math.round((2 * Math.PI * rIn) / 11);
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    const led = new THREE.Mesh(new THREE.BoxGeometry(5, 5, 1.4), ledMat);
    led.position.copy(W(LAMP.x + Math.cos(a) * (rIn - 0.8), LAMP.y + Math.sin(a) * (rIn - 0.8), STRIP_H));
    led.lookAt(W(LAMP.x, LAMP.y, STRIP_H));
    strip.add(led);
  }
  const cv = document.createElement("canvas"); cv.width = cv.height = 128;
  const c2 = cv.getContext("2d"), gr = c2.createRadialGradient(64, 64, 10, 64, 64, 64);
  gr.addColorStop(0, "rgba(255,255,255,0.15)"); gr.addColorStop(0.75, "rgba(255,255,255,0.9)"); gr.addColorStop(1, "rgba(255,255,255,0)");
  c2.fillStyle = gr; c2.fillRect(0, 0, 128, 128);
  glowMat.map = new THREE.CanvasTexture(cv);
  const glow = new THREE.Mesh(new THREE.CircleGeometry(lampR(LAMP.soil) - 1, 64), glowMat);
  glow.rotation.x = -Math.PI / 2; glow.position.copy(W(LAMP.x, LAMP.y, LAMP.soil + 0.3)); strip.add(glow);
  glow.raycast = () => {};
  stripLight.position.copy(W(LAMP.x, LAMP.y, LAMP.sleeveTop + 8)); scene.add(stripLight);
  box(strip, 7, 7, 4, M.black, LAMP.x + Math.cos(plugAngle) * (LAMP.sleeveR + 6), LAMP.y + Math.sin(plugAngle) * (LAMP.sleeveR + 6), LAMP.sleeveTop - 2);
  wire(wiresGroup, hole(2, "bottom", 3), plugAt(1), "green", 14);   // R
  wire(wiresGroup, hole(7, "bottom", 3), plugAt(2), "green", 12);   // G
  wire(wiresGroup, hole(12, "bottom", 3), plugAt(3), "green", 10);  // B
}
const power = part("12 V adapter and cut DC cable", "The strip's own 12 V adapter. Its + goes to the strip, its − joins the board's ground; 12 V never touches the board's pins.");
{
  const ax = 122, ay = 40;
  box(power, 34, 52, 26, mat(0x1c1c1c, { roughness: 0.5 }), ax, ay, 0);
  box(power, 6, 10, 6, M.black, ax - 30, ay - 8, 0);                           // barrel jack end
  wire(power, W(ax - 17, ay, 8), W(ax - 30, ay - 8, 4), 0x161616, 6, 1.4);
  wire(wiresGroup, W(ax - 33, ay - 8, 4), plugAt(0), "red", 14, 0.6);          // + to the strip's 12V
  wire(wiresGroup, W(ax - 33, ay - 10, 4), hole(15, "bottom", 0), "white", 16, 0.6);   // − to ground
}

// ---------------------------------------------------------------- mood colours (rising sun), as the sketch drives the strip
const MOODS = { 1: [110, 22, 0, 0], 2: [190, 70, 10, 15], 3: [200, 115, 35, 70], 4: [255, 150, 20, 90], 5: [255, 200, 60, 160] };
const WORDS = { 1: "low", 2: "meh", 3: "ok", 4: "good", 5: "great" };
function moodColour(m) {
  const [r, g, b, w] = MOODS[m];
  const rr = Math.min(255, r + w), gg = Math.min(255, g + w * 0.45), bb = Math.min(255, b + w * 0.12);
  return new THREE.Color(rr / 255, gg / 255, bb / 255);
}
let mood = 3;
function setMood(m) {
  mood = m;
  const c = moodColour(m);
  ledMat.emissive.copy(c); ledMat.emissiveIntensity = 1.2 + m * 0.35;
  glowMat.color.copy(c); glowMat.opacity = 0.3 + m * 0.08;
  stripLight.color.copy(c); stripLight.intensity = 900 + m * 500;
  const rows = DIGITS[m];
  for (let r = 0; r < 8; r++) for (let col = 0; col < 13; col++) {
    const on = r >= 1 && r <= 5 && col >= 5 && col <= 7 && rows[r - 1][col - 5] === "1";
    matrix.setColorAt(r * 13 + col, on ? c.clone().multiplyScalar(1.6) : new THREE.Color(0x1a1a1a));
  }
  matrix.instanceColor.needsUpdate = true;
  moodButtons.forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.mood) === m)));
  const label = document.getElementById("hw3d-mood");
  if (label) label.textContent = `Mood ${m} (${WORDS[m]})`;
  requestRender();
}
let cycling = !reduceMotion, cycleTimer = 0;
moodButtons.forEach((b) => b.addEventListener("click", () => { cycling = false; setMood(Number(b.dataset.mood)); }));

// ---------------------------------------------------------------- hover labels
const ray = new THREE.Raycaster(), ptr = new THREE.Vector2();
let hoverPart = null;
renderer.domElement.addEventListener("pointermove", (e) => {
  const r = renderer.domElement.getBoundingClientRect();
  ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ptr, camera);
  const hit = ray.intersectObjects(parts, true)[0];
  let g = hit?.object; while (g && !g.userData.name) g = g.parent;
  hoverPart = g || null;
  if (hoverPart) {
    tip.hidden = false;
    tip.innerHTML = `<strong>${hoverPart.userData.name}</strong><span>${hoverPart.userData.desc}</span>`;
    const x = Math.min(e.clientX - r.left + 14, r.width - tip.offsetWidth - 8);
    tip.style.left = `${Math.max(8, x)}px`;
    tip.style.top = `${Math.max(8, e.clientY - r.top + 14)}px`;
  } else tip.hidden = true;
});
renderer.domElement.addEventListener("pointerleave", () => { tip.hidden = true; });
renderer.domElement.addEventListener("pointerdown", () => { controls.autoRotate = false; });

// ---------------------------------------------------------------- render loop (only while on screen)
let visible = false, needRender = true, zoom = 1.05;
const baseDist = camera.position.distanceTo(controls.target);
for (const [id, f] of [["hw3d-in", 1.25], ["hw3d-out", 0.8]]) {
  document.getElementById(id)?.addEventListener("click", () => {
    zoom = Math.min(2.6, Math.max(0.7, zoom * f));
    controls.autoRotate = false;
    resize();
  });
}
function requestRender() { needRender = true; }
controls.addEventListener("change", requestRender);
function resize() {
  const w = host.clientWidth, h = host.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.position.sub(controls.target).setLength(baseDist * (w < 560 ? 1.12 : 1) / zoom).add(controls.target);
  camera.updateProjectionMatrix();
  requestRender();
}
new ResizeObserver(resize).observe(host);
new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) loop(); }, { threshold: 0.05 }).observe(host);
let last = 0;
function loop(t = 0) {
  if (!visible) return;
  requestAnimationFrame(loop);
  if (cycling && t - cycleTimer > 2600) { cycleTimer = t; setMood((mood % 5) + 1); }
  controls.update();
  if (needRender || controls.autoRotate || t - last > 1000) { renderer.render(scene, camera); needRender = false; last = t; }
}
resize();
setMood(3);
// For rendering the video frame by frame (only with ?capture in the address; visitors never get this).
if (new URLSearchParams(location.search).has("capture")) {
  window.__hw3d = { THREE, camera, controls, scene, renderer, setMood, render: () => renderer.render(scene, camera) };
}
host.classList.add("ready");
