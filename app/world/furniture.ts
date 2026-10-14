import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BENCH_SIZE } from './layout';
import { shadowDecal } from './surfaces';

const cushionMat = new THREE.MeshStandardMaterial({ color: 0x2b2522, roughness: 0.62 });
const steelMat = new THREE.MeshStandardMaterial({ color: 0x1e1e1e, metalness: 0.3, roughness: 0.5 });

let legsGeo: THREE.BufferGeometry | undefined;

/** Upholstered gallery bench on slim steel legs, long side along x, origin on the floor. */
export function createBench(): THREE.Group {
  const { length, depth, height } = BENCH_SIZE;
  const cushionH = 0.09;
  const group = new THREE.Group();
  group.name = 'bench';

  const cushion = new THREE.Mesh(new THREE.BoxGeometry(length, cushionH, depth), cushionMat);
  cushion.position.y = height - cushionH / 2;
  group.add(cushion);

  if (!legsGeo) {
    const legH = height - cushionH;
    const inset = 0.1;
    const legs: THREE.BufferGeometry[] = [];
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        legs.push(
          new THREE.BoxGeometry(0.035, legH, 0.035)
            .translate(sx * (length / 2 - inset), legH / 2, sz * (depth / 2 - inset))
            .toNonIndexed(),
        );
      }
      // Cross rail between each pair of legs.
      legs.push(
        new THREE.BoxGeometry(0.03, 0.03, depth - 2 * inset).translate(sx * (length / 2 - inset), 0.12, 0).toNonIndexed(),
      );
    }
    legsGeo = mergeGeometries(legs);
  }
  group.add(new THREE.Mesh(legsGeo, steelMat));

  const shadow = shadowDecal(length * 0.95, depth * 0.9, 0.55);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.002;
  group.add(shadow);

  return group;
}
