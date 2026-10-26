'use client';

import { Environment, Lightformer } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import type { MotionValue } from 'framer-motion';
import { useMemo, useRef, type ReactNode } from 'react';
import * as THREE from 'three';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';

import { LOGO_GREEN, MARK } from '@/components/brand';

/*
 * The CoreTask mark in 3D, extruded from the logo pack's own paths: the two
 * halves of the shell, the green crescent, and the core — a green disc with
 * the check cut out of it.
 *
 * The hero's scroll position tells the story. At the top the pieces drift
 * apart — scattered work. Scrolling pulls them into the mark, and then the
 * core turns to face you and lights up: the request is done.
 */

const GREEN = new THREE.Color(LOGO_GREEN);
const WHITE = new THREE.Color('#F1F1F4');
const UNLIT = new THREE.Color('#34343c');

/** One SVG unit in world units: the 148-unit-tall mark stands about 4.4 high. */
const UNIT = 0.03;

type PieceName = 'shellLower' | 'shellUpper' | 'crescent' | 'core';

type Piece = {
  name: PieceName;
  /** Where the piece drifts while the work is still scattered, from its place. */
  from: [number, number, number];
  spin: [number, number, number];
};

// Offsets keep every piece right of centre, so none crosses the headline.
const PIECES: Piece[] = [
  { name: 'shellLower', from: [-0.6, -2.2, 1.0], spin: [1.0, 0.6, -0.8] },
  { name: 'shellUpper', from: [-1.2, 1.9, -1.8], spin: [-0.8, -1.1, 0.6] },
  { name: 'crescent', from: [2.0, 2.4, -2.8], spin: [0.7, 1.3, -0.5] },
  { name: 'core', from: [2.6, -1.0, -1.2], spin: [-1.2, -0.7, 1.0] },
];

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (v: number) => {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
};

/**
 * Extrudes one of the mark's paths. The group transform centres the mark on
 * the origin and flips SVG's downward y; the geometry is then re-centred on its
 * own middle, so each piece turns about itself, and `offset` says where that
 * middle sits in the assembled mark.
 */
function pieceGeometry(d: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg"><g transform="matrix(1 0 0 -1 -54.52 83.5)"><path d="${d}"/></g></svg>`;
  const shapes = new SVGLoader().parse(svg).paths.flatMap((path) => SVGLoader.createShapes(path));
  const geometry = new THREE.ExtrudeGeometry(shapes, {
    depth: 12,
    bevelEnabled: true,
    bevelThickness: 1.6,
    bevelSize: 1.1,
    bevelSegments: 4,
    curveSegments: 48,
  });
  geometry.scale(UNIT, UNIT, UNIT);
  geometry.computeBoundingBox();
  const offset = new THREE.Vector3();
  geometry.boundingBox?.getCenter(offset);
  geometry.translate(-offset.x, -offset.y, -offset.z);
  return { geometry, offset };
}

function Mark({ progress }: { progress: MotionValue<number> }) {
  const group = useRef<THREE.Group>(null);
  const pieces = useRef<(THREE.Group | null)[]>([]);
  const coreMaterial = useRef<THREE.MeshPhysicalMaterial>(null);
  const coreLight = useRef<THREE.PointLight>(null);
  const eased = useRef(0);
  const intro = useRef(0);
  const { viewport, size } = useThree();

  const built = useMemo(
    () => Object.fromEntries(PIECES.map(({ name }) => [name, pieceGeometry(MARK[name])])),
    [],
  ) as Record<PieceName, ReturnType<typeof pieceGeometry>>;

  // Placed by the page's own breakpoints, in CSS pixels, so the mark always
  // sits where the headline is not: beside it from lg (1024) up, beside it but
  // smaller and further out from md (768), and above it on a phone, where the
  // text fills most of the screen and the pieces scatter less.
  const layout = size.width >= 1024 ? 'wide' : size.width >= 768 ? 'medium' : 'narrow';
  const scale =
    layout === 'wide'
      ? THREE.MathUtils.clamp(viewport.width / 16, 0.5, 0.82)
      : layout === 'medium'
        ? Math.min(0.5, (viewport.width * 0.28) / 2.7)
        : Math.min(0.32, viewport.width / 11);
  const anchor: [number, number] =
    layout === 'wide'
      ? [viewport.width * 0.25, 0]
      : layout === 'medium'
        ? [viewport.width * 0.33, 0]
        : [0, viewport.height / 2 - 1.45];
  const spread = layout === 'narrow' ? 0.45 : layout === 'medium' ? 0.7 : 1;

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
      const { name, from, spin } = PIECES[i];
      const { offset } = built[name];
      // Staggered: the pieces land one after another, not as a block.
      const a = smooth(assemble * 1.35 - i * 0.12);
      const scatter = (1 - a) * spread;
      const drift = (1 - a) * 0.18;
      // On load the pieces arrive out of the distance rather than from the sides.
      const approach = (1 - arrive) * (9 + i * 2);
      piece.position.set(
        offset.x + from[0] * scatter + Math.sin(t * 0.7 + i * 1.9) * drift,
        offset.y + from[1] * scatter + Math.cos(t * 0.6 + i * 2.3) * drift,
        offset.z + from[2] * scatter - approach,
      );
      piece.rotation.set(
        spin[0] * (1 - a) + Math.sin(t * 0.4 + i) * 0.12 * (1 - a),
        spin[1] * (1 - a),
        spin[2] * (1 - a),
      );
      if (name === 'core') {
        // Once in place the core turns a half-turn to face you as it lights,
        // and swells a little past full size before it settles.
        piece.rotation.y += (1 - done) * Math.PI * a;
        piece.scale.setScalar(0.72 + 0.28 * done + Math.sin(done * Math.PI) * 0.08);
      }
    });

    const core = coreMaterial.current;
    if (core) {
      core.color.copy(UNLIT).lerp(GREEN, done);
      core.emissive.copy(GREEN);
      core.emissiveIntensity = done * (0.28 + Math.sin(t * 2.2) * 0.05);
    }
    if (coreLight.current) coreLight.current.intensity = done * 9;

    const g = group.current;
    if (g) {
      const pointer = state.pointer;
      g.rotation.y = THREE.MathUtils.damp(
        g.rotation.y,
        -0.5 + assemble * 0.26 + pointer.x * 0.22,
        3,
        delta,
      );
      g.rotation.x = THREE.MathUtils.damp(
        g.rotation.x,
        0.28 - assemble * 0.12 - pointer.y * 0.14,
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
      {PIECES.map(({ name }, i) => (
        <group
          key={name}
          ref={(node) => {
            pieces.current[i] = node;
          }}
        >
          <mesh geometry={built[name].geometry}>
            {name === 'shellLower' || name === 'shellUpper' ? (
              <meshPhysicalMaterial
                color={WHITE}
                metalness={0.05}
                roughness={0.28}
                clearcoat={1}
                clearcoatRoughness={0.12}
              />
            ) : name === 'crescent' ? (
              <meshPhysicalMaterial
                color={GREEN}
                emissive={GREEN}
                emissiveIntensity={0.18}
                metalness={0.1}
                roughness={0.3}
                clearcoat={1}
                clearcoatRoughness={0.2}
              />
            ) : (
              <meshPhysicalMaterial
                ref={coreMaterial}
                color={UNLIT}
                metalness={0.1}
                roughness={0.3}
                clearcoat={1}
                clearcoatRoughness={0.2}
              />
            )}
          </mesh>
          {name === 'core' && (
            <pointLight
              ref={coreLight}
              color={GREEN}
              distance={5}
              decay={1.6}
              position={[0, 0, 1.4]}
            />
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
        <Lightformer
          form="ring"
          color={LOGO_GREEN}
          intensity={2.2}
          position={[5, -2, 3]}
          scale={3}
        />
      </Environment>
      <Mark progress={progress} />
      <Dust />
    </Canvas>
  );
}
