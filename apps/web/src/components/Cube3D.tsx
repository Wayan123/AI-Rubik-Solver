import { OrbitControls } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { applyMove, type CubeState, type Face, type Move, STICKERS } from "@rubik-arena/cube-engine";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type * as THREE from "three";

/** Sticker colours by face letter (standard Western scheme: U white, F green, R red). */
export const FACE_COLORS: Record<Face, string> = {
  U: "#f4f4f1",
  D: "#e8b33a",
  F: "#2f9e5b",
  B: "#2c64c6",
  R: "#c8352d",
  L: "#ec7a2a",
};

const AXIS: Record<Face, { axis: "x" | "y" | "z"; layer: 1 | -1 }> = {
  U: { axis: "y", layer: 1 },
  D: { axis: "y", layer: -1 },
  R: { axis: "x", layer: 1 },
  L: { axis: "x", layer: -1 },
  F: { axis: "z", layer: 1 },
  B: { axis: "z", layer: -1 },
};

const CUBIE = 0.94;
const STICKER = 0.8;

interface StickerMesh {
  index: number;
  pos: readonly [number, number, number];
  normal: readonly [number, number, number];
}

/** Stickers grouped by cubie position (26 visible cubies). */
const CUBIES: Array<{ key: string; pos: [number, number, number]; stickers: StickerMesh[] }> = (() => {
  const map = new Map<string, { pos: [number, number, number]; stickers: StickerMesh[] }>();
  STICKERS.forEach((s, index) => {
    const key = s.pos.join(",");
    const entry = map.get(key) ?? { pos: [...s.pos] as [number, number, number], stickers: [] };
    entry.stickers.push({ index, pos: s.pos, normal: s.normal });
    map.set(key, entry);
  });
  return [...map.entries()].map(([key, v]) => ({ key, ...v }));
})();

function stickerTransform(normal: readonly [number, number, number]): {
  position: [number, number, number];
  rotation: [number, number, number];
} {
  const [x, y, z] = normal;
  const d = CUBIE / 2 + 0.002;
  const position: [number, number, number] = [x * d, y * d, z * d];
  if (x) return { position, rotation: [0, (Math.PI / 2) * x, 0] };
  if (y) return { position, rotation: [(-Math.PI / 2) * y, 0, 0] };
  return { position, rotation: [0, z > 0 ? 0 : Math.PI, 0] };
}

function angleOf(move: Move): number {
  // Clockwise when looking at the face = negative rotation about its outward axis.
  const quarter = move.length === 1 ? 1 : move[1] === "2" ? 2 : -1;
  const layer = AXIS[move[0] as Face].layer;
  return (-Math.PI / 2) * quarter * layer;
}

interface Animation {
  move: Move;
  from: CubeState;
  to: CubeState;
  t: number;
}

interface CubeProps {
  /** Target state; the cube animates the queued moves from its current state to reach it. */
  state: CubeState;
  /** Moves that lead to `state` (appended over time). When they don't match, the cube snaps. */
  moves: readonly Move[];
  /** Seconds per quarter turn (scaled down automatically when a backlog builds up). */
  speed?: number;
  reducedMotion?: boolean;
}

function CubeModel({ state, moves, speed = 0.22, reducedMotion }: CubeProps) {
  const pivot = useRef<THREE.Group>(null);
  const [shown, setShown] = useState<CubeState>(state);
  const [anim, setAnim] = useState<Animation | null>(null);
  const animRef = useRef<Animation | null>(null);
  const shownRef = useRef(state);
  const queue = useRef<Move[]>([]);
  const target = useRef(state);
  /** Number of `moves` already enqueued or played. */
  const known = useRef(moves.length);

  const show = useCallback((s: CubeState) => {
    shownRef.current = s;
    setShown(s);
  }, []);
  const setAnimation = useCallback((a: Animation | null) => {
    animRef.current = a;
    setAnim(a);
  }, []);

  useEffect(() => {
    target.current = state;
    if (moves.length > known.current) {
      queue.current.push(...moves.slice(known.current));
      known.current = moves.length;
    } else if (moves.length < known.current) {
      // New race or replay scrub backwards: snap.
      queue.current = [];
      known.current = moves.length;
      setAnimation(null);
      if (pivot.current) pivot.current.rotation.set(0, 0, 0);
      show(state);
    }
  }, [moves, state, show, setAnimation]);

  useFrame((_, delta) => {
    const current = animRef.current;
    if (!current) {
      const next = queue.current.shift();
      if (!next) {
        // Idle and out of sync (new race, or state without moves): snap to the target.
        if (shownRef.current !== target.current) show(target.current);
        return;
      }
      const to = applyMove(shownRef.current, next);
      if (reducedMotion) show(to);
      else setAnimation({ move: next, from: shownRef.current, to, t: 0 });
      return;
    }
    const duration = speed / (1 + queue.current.length / 3);
    const t = Math.min(1, current.t + delta / duration);
    const eased = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    if (pivot.current) {
      const { axis } = AXIS[current.move[0] as Face];
      pivot.current.rotation.set(0, 0, 0);
      pivot.current.rotation[axis] = angleOf(current.move) * eased;
    }
    if (t >= 1) {
      if (pivot.current) pivot.current.rotation.set(0, 0, 0);
      show(current.to);
      setAnimation(null);
    } else {
      current.t = t;
    }
  });

  const colors = anim ? anim.from : shown;
  const turning = anim ? AXIS[anim.move[0] as Face] : null;
  const inLayer = (pos: readonly number[]) =>
    turning ? pos[{ x: 0, y: 1, z: 2 }[turning.axis]] === turning.layer : false;

  const renderCubie = (c: (typeof CUBIES)[number]) => (
    <group key={c.key} position={c.pos}>
      <mesh>
        <boxGeometry args={[CUBIE, CUBIE, CUBIE]} />
        <meshStandardMaterial color="#111316" roughness={0.6} />
      </mesh>
      {c.stickers.map((s) => {
        const tr = stickerTransform(s.normal);
        return (
          <mesh key={s.index} position={tr.position} rotation={tr.rotation}>
            <planeGeometry args={[STICKER, STICKER]} />
            <meshStandardMaterial color={FACE_COLORS[colors[s.index] as Face] ?? "#555"} roughness={0.35} />
          </mesh>
        );
      })}
    </group>
  );

  return (
    <group rotation={[0.45, -0.62, 0]}>
      <group ref={pivot}>{CUBIES.filter((c) => inLayer(c.pos)).map(renderCubie)}</group>
      {CUBIES.filter((c) => !inLayer(c.pos)).map(renderCubie)}
    </group>
  );
}

export interface Cube3DProps extends CubeProps {
  label: string;
  interactive?: boolean;
}

export function Cube3D({ label, interactive = true, ...props }: Cube3DProps) {
  const reduced = useMemo(
    () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
    [],
  );
  return (
    <div className="cube3d" role="img" aria-label={label}>
      <Canvas camera={{ position: [0, 0, 7.2], fov: 38 }} dpr={[1, 2]} frameloop="always">
        <ambientLight intensity={0.9} />
        <directionalLight position={[4, 6, 5]} intensity={1.4} />
        <directionalLight position={[-5, -3, -4]} intensity={0.4} />
        <CubeModel {...props} reducedMotion={props.reducedMotion ?? reduced} />
        {interactive && <OrbitControls enablePan={false} enableZoom={false} rotateSpeed={0.7} />}
      </Canvas>
    </div>
  );
}
