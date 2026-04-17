export interface Particle {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: string;
  opacity: number;
  layer: "buffer" | "episodic" | "semantic";
  strength: number;
  pulsePhase: number;
  selected: boolean;
}

export const LAYER_COLORS = {
  buffer: "#7c5cff",
  episodic: "#f0a030",
  semantic: "#34d399",
} as const;
