'use client';

import { Environment, Lightformer } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import type { MotionValue } from 'framer-motion';
import { useMemo, useRef, type ReactNode } from 'react';
import * as THREE from 'three';

/*
 * The CoreTask mark, built in 3D from the logo's own geometry: the SVG is a
 * 64-unit square of 22-unit squares (a 4-unit stroke round a 14-unit hole),
 * so one SVG unit is 0.1 here and the squares sit 1.5 from the centre.
 *
 * The hero's scroll position tells the story. At the top the squares drift
 * apart — scattered work. Scrolling pulls them into the grid, and then the
 * last one fills green: the request is done.
 */

const OUTER = 1.1;
const INNER = 0.7;
const DEPTH = 0.34;
const GREEN = new THREE.Color('#85C854');
const WHITE = new THREE.Color('#F1F1F4');

type Piece = {
  target: [number, number, number];
  from: [number, number, number];
  spin: [number, number, number];
};

// `from` is where each square drifts while the work is still scattered. All
// four stay to the right of centre so they never cross the headline.
const PIECES: Piece[] = [
  { target: [-1.5, 1.5, 0], from: [-2.0, 2.3, -1.6], spin: [0.9, -1.2, 0.5] },
  { target: [1.5, 1.5, 0], from: [3.3, 2.5, -3.4], spin: [-0.6, 1.4, -0.8] },
  { target: [-1.5, -1.5, 0], from: [-1.8, -2.6, 0.4], spin: [1.3, 0.4, -1.1] },
  { target: [1.5, -1.5, 0], from: [3.6, -2.0, -1.2], spin: [-1.0, -0.9, 1.2] },
];

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (v: number) => {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
};

function squareShape(withHole: boolean) {
  const shape = new THREE.Shape();
  shape.moveTo(-OUTER, -OUTER);
  shape.lineTo(OUTER, -OUTER);
  shape.lineTo(OUTER, OUTER);
  shape.lineTo(-OUTER, OUTER);
  shape.closePath();
  if (withHole) {
    const hole = new THREE.Path();
    hole.moveTo(-INNER, -INNER);
    hole.lineTo(-INNER, INNER);
    hole.lineTo(INNER, INNER);
    hole.lineTo(INNER, -INNER);
    hole.closePath();
    shape.holes.push(hole);
  }
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: DEPTH,
    bevelEnabled: true,
    bevelThickness: 0.05,
    bevelSize: 0.035,
    bevelSegments: 4,
    curveSegments: 1,
  });
  geometry.center();
  return geometry;
}

function Mark({ progress }: { progress: MotionValue<number> }) {
  const group = useRef<THREE.Group>(null);
  const pieces = useRef<(THREE.Group | null)[]>([]);
  const fill = useRef<THREE.Mesh>(null);
  const doneLight = useRef<THREE.PointLight>(null);
  const eased = useRef(0);
  const intro = useRef(0);
  const { viewport } = useThree();

  const frame = useMemo(() => squareShape(true), []);
  const solid = useMemo(() => squareShape(false), []);
  // Mutated every frame, so held in refs: three.js objects are mutable by
  // design, and refs are where React expects mutation.
  const doneFrameMaterial = useRef<THREE.MeshPhysicalMaterial>(null);
  const fillMaterial = useRef<THREE.MeshPhysicalMaterial>(null);

  // Side by side with the text on wide screens, above it on narrow ones.
  const wide = viewport.width >= 9;
  const scale = wide
    ? THREE.MathUtils.clamp(viewport.width / 17, 0.5, 0.8)
    : Math.min(0.34, viewport.width / 11);
  // On a phone the text fills most of the screen, so the mark sits just under
  // the header and its squares scatter less.
  const anchor: [number, number] = wide
    ? [viewport.width * 0.25, 0]
    : [0, viewport.height / 2 - 1.55];
  const spread = wide ? 1 : 0.45;

  useFrame((state, delta) => {
    eased.current = THREE.MathUtils.damp(eased.current, progress.get(), 7, delta);
    intro.current = Math.min(1, intro.current + delta / 1.8);
    const p = eased.current;
    const t = state.clock.elapsedTime;
    const arrive = smooth(intro.current);
    const assemble = smooth((p - 0.03) / 0.45);
    const done = smooth((p - 0.5) / 0.14);

    pieces.current.forEach((piece, i) => {
      if (!piece) return;
      const { target, from, spin } = PIECES[i];
      // Staggered: the squares land one after another, not as a block.
      const a = smooth(assemble * 1.35 - i * 0.12);
      const scatter = (1 - a) * spread;
      const drift = (1 - a) * 0.18;
      // On load the squares arrive out of the distance rather than from the sides.
      const approach = (1 - arrive) * (9 + i * 2);
      piece.position.set(
        target[0] + (from[0] - target[0]) * scatter + Math.sin(t * 0.7 + i * 1.9) * drift,
        target[1] + (from[1] - target[1]) * scatter + Math.cos(t * 0.6 + i * 2.3) * drift,
        target[2] + (from[2] - target[2]) * scatter - approach,
      );
      piece.rotation.set(
        spin[0] * (1 - a) + Math.sin(t * 0.4 + i) * 0.12 * (1 - a),
        spin[1] * (1 - a),
        spin[2] * (1 - a),
      );
    });

    if (fill.current) {
      // A hair larger and deeper than the outline it fills, so the two faces
      // never share a plane and flicker against each other.
      const d = Math.max(done, 0.001);
      fill.current.scale.set(d * 1.01, d * 1.01, 1.08);
    }
    if (fillMaterial.current) {
      fillMaterial.current.emissiveIntensity = 0.15 + done * 0.55 + Math.sin(t * 2.2) * 0.06 * done;
    }
    doneFrameMaterial.current?.color.copy(WHITE).lerp(GREEN, done);
    if (doneLight.current) doneLight.current.intensity = done * 8;

    const g = group.current;
    if (g) {
      const pointer = state.pointer;
      g.rotation.y = THREE.MathUtils.damp(
        g.rotation.y,
        -0.5 + assemble * 0.22 + pointer.x * 0.22,
        3,
        delta,
      );
      g.rotation.x = THREE.MathUtils.damp(
        g.rotation.x,
        0.32 - assemble * 0.12 - pointer.y * 0.14,
        3,
        delta,
      );
      const leave = smooth((p - 0.78) / 0.22);
      g.position.set(anchor[0], anchor[1] + leave * 1.4 + Math.sin(t * 0.8) * 0.06, -leave * 2);
      g.scale.setScalar(scale);
    }
  });

  return (
    <group ref={group}>
      {PIECES.map((_, i) => (
        <group
          key={i}
          ref={(node) => {
            pieces.current[i] = node;
          }}
        >
          <mesh geometry={frame}>
            <meshPhysicalMaterial
              ref={i === 3 ? doneFrameMaterial : undefined}
              color={WHITE}
              metalness={0.05}
              roughness={0.28}
              clearcoat={1}
              clearcoatRoughness={0.12}
            />
          </mesh>
          {i === 3 && (
            <>
              <mesh ref={fill} geometry={solid}>
                <meshPhysicalMaterial
                  ref={fillMaterial}
                  color={GREEN}
                  emissive={GREEN}
                  emissiveIntensity={0.2}
                  metalness={0.1}
                  roughness={0.3}
                  clearcoat={1}
                  clearcoatRoughness={0.2}
                />
              </mesh>
              <pointLight
                ref={doneLight}
                color={GREEN}
                distance={6}
                decay={1.6}
                position={[-1.4, 1.4, 0.9]}
              />
            </>
          )}
        </group>
      ))}
    </group>
  );
}

/** A slow field of dust, for depth. */
function Dust({ count = 240 }: { count?: number }) {
  const points = useRef<THREE.Points>(null);
  const geometry = useMemo(() => {
    const positions = new Float32Array(count * 3);
    // A fixed pseudo-random sequence, so the field is the same on every load.
    let seed = 7;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let i = 0; i < count; i++) {
      const r = 4 + rand() * 9;
      const theta = rand() * Math.PI * 2;
      const phi = Math.acos(2 * rand() - 1);
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta) * 0.6;
      positions[i * 3 + 2] = r * Math.cos(phi) - 4;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return g;
  }, [count]);

  useFrame((_, delta) => {
    if (points.current) points.current.rotation.y += delta * 0.015;
  });

  return (
    <points ref={points} geometry={geometry}>
      <pointsMaterial
        size={0.035}
        color="#ffffff"
        transparent
        opacity={0.35}
        sizeAttenuation
        depthWrite={false}
      />
    </points>
  );
}

export default function MarkScene({
  progress,
  active,
  fallback,
  onReady,
}: {
  progress: MotionValue<number>;
  active: boolean;
  fallback: ReactNode;
  onReady?: () => void;
}) {
  return (
    <Canvas
      camera={{ position: [0, 0, 12], fov: 35 }}
      dpr={[1, 1.75]}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      frameloop={active ? 'always' : 'never'}
      fallback={fallback}
      onCreated={() => onReady?.()}
      aria-hidden
    >
      <ambientLight intensity={0.7} />
      <directionalLight position={[4, 6, 6]} intensity={2.6} />
      <directionalLight position={[-6, -2, 2]} intensity={0.6} color="#9fb4ff" />
      <Environment resolution={256} frames={1} environmentIntensity={1.3}>
        <Lightformer form="rect" intensity={2.4} position={[0, 4, 5]} scale={[10, 2, 1]} />
        <Lightformer
          form="rect"
          intensity={1.1}
          position={[-6, 0, 2]}
          rotation-y={Math.PI / 2}
          scale={[8, 2, 1]}
        />
        <Lightformer form="ring" color="#85C854" intensity={2.2} position={[5, -2, 3]} scale={3} />
      </Environment>
      <Mark progress={progress} />
      <Dust />
    </Canvas>
  );
}
