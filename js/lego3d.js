// Drawing the attachment builder's LEGO parts: one packed file (models/lego/parts.mpd) holds every palette part at
// the origin; each becomes a template mesh group that placed parts clone. Parts are placed in the Driving Base's LDraw
// frame (see lego.js); LD_TO_ROBOT turns that frame into the robot's (x forward, y up, z right, cm).
import * as THREE from 'three';
import { LDrawLoader } from 'three/addons/loaders/LDrawLoader.js';
import { LDrawConditionalLineMaterial } from 'three/addons/materials/LDrawConditionalLineMaterial.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LDU } from './lego.js';

export const LD_TO_ROBOT = new THREE.Matrix4().set(0, 0, -LDU, 0, 0, -LDU, 0, 0, -LDU, 0, 0, 0, 0, 0, 0, 1);

let loader = null, materials = null;
function ldraw() {
  if (!loader) {
    loader = new LDrawLoader();
    loader.smoothNormals = true;
    loader.setConditionalLineMaterial(LDrawConditionalLineMaterial);
    materials = loader.preloadMaterials('models/LDConfig.ldr').catch(() => {});
  }
  return loader;
}
let queue = Promise.resolve();
const cache = new Map();
/** Load an LDraw file as a raw group (children = the main model's parts, in order). Loads run one at a time. */
export function loadRaw(url) {
  if (!cache.has(url)) {
    const job = queue.then(async () => {
      const l = ldraw();
      await materials;
      return new Promise((resolve) => l.load(url, (g) => resolve(g), undefined, (err) => { console.warn('LDraw model failed', url, err); resolve(null); }));
    });
    queue = job.catch(() => {});
    cache.set(url, job);
  }
  return cache.get(url);
}

/** Merge the meshes under an object into one mesh per material, in the object's own frame. */
export function flatten(obj) {
  obj.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(obj.matrixWorld).invert();
  const byMat = new Map();
  obj.traverse((o) => {
    if (!o.isMesh || !o.geometry.attributes.position) return;
    const mat = Array.isArray(o.material) ? o.material[0] : o.material;
    let g = o.geometry.clone();
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    for (const n of Object.keys(g.attributes)) if (n !== 'position' && n !== 'normal') g.deleteAttribute(n);
    if (g.index) { const g2 = g.toNonIndexed(); g.dispose(); g = g2; }
    byMat.set(mat, (byMat.get(mat) || []).concat(g));
  });
  const out = new THREE.Group();
  for (const [mat, geos] of byMat) {
    const merged = mergeGeometries(geos, false);
    geos.forEach((g) => g.dispose());
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = true; mesh.receiveShadow = true;
    out.add(mesh);
  }
  return out;
}

let templates = null;
/** Map part number -> template group (geometry in the part's LDraw frame, LDU). */
export function partTemplates(D) {
  if (!templates) {
    templates = loadRaw('models/lego/parts.mpd').then((g) => {
      const map = new Map();
      if (!g) return map;
      const names = D.parts.categories.flatMap((c) => c.parts);
      [...g.children].forEach((child, i) => {
        const fromFile = String(child.userData.fileName || '').toLowerCase().replace(/\.dat$/, '');
        const name = names.includes(fromFile) ? fromFile : names[i];
        child.matrix.identity(); child.position.set(0, 0, 0); child.quaternion.identity(); child.scale.set(1, 1, 1);
        child.updateMatrix();
        const holder = new THREE.Group(); holder.add(child);
        map.set(name, flatten(holder));
      });
      return map;
    });
  }
  return templates;
}

/** The matrix (LDraw frame, LDU) of a placement. */
export function placementMatrix(q) {
  const r = q.r, p = q.p;
  return new THREE.Matrix4().set(r[0], r[1], r[2], p[0], r[3], r[4], r[5], p[1], r[6], r[7], r[8], p[2], 0, 0, 0, 1);
}

/** A mesh for a placed part (shares the template's geometry and materials). */
export function partMesh(tpl, q) {
  const m = tpl.clone();
  m.matrixAutoUpdate = false;
  m.matrix.copy(placementMatrix(q));
  m.userData.placement = q;
  return m;
}
