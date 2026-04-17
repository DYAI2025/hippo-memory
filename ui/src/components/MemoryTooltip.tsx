import type { Memory } from "../types.js";
import { LAYER_COLORS } from "../engine/types.js";

interface MemoryTooltipProps {
  memory: Memory;
  x: number;
  y: number;
}

export function MemoryTooltip({ memory, x, y }: MemoryTooltipProps) {
  const preview = memory.content.length > 100 ? memory.content.slice(0, 100) + "\u2026" : memory.content;
  const layerColor = LAYER_COLORS[memory.layer];

  return (
    <div style={{
      position: "fixed",
      left: x + 16,
      top: y - 12,
      background: "rgba(8, 10, 14, 0.92)",
      backdropFilter: "blur(20px)",
      WebkitBackdropFilter: "blur(20px)",
      border: "1px solid rgba(255,255,255,0.06)",
      borderRadius: 12,
      padding: "12px 14px",
      maxWidth: 280,
      pointerEvents: "none" as const,
      zIndex: 100,
      boxShadow: `0 4px 24px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.02), inset 0 1px 0 rgba(255,255,255,0.03)`,
    }}>
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        marginBottom: 8,
      }}>
        <div style={{
          width: 5,
          height: 5,
          borderRadius: "50%",
          background: layerColor,
          boxShadow: `0 0 6px ${layerColor}60`,
        }} />
        <span style={{
          color: "var(--muted)",
          fontSize: 9,
          fontFamily: "var(--font-mono)",
          textTransform: "uppercase",
          letterSpacing: "0.5px",
        }}>
          {memory.layer}
        </span>
        <span style={{ color: "rgba(255,255,255,0.1)", fontSize: 9 }}>&middot;</span>
        <span style={{
          color: "var(--muted)",
          fontSize: 9,
          fontFamily: "var(--font-mono)",
        }}>
          {memory.strength.toFixed(2)} str
        </span>
      </div>
      <div style={{
        color: "var(--text)",
        fontSize: 12,
        lineHeight: 1.5,
        fontFamily: "var(--font-body)",
      }}>
        {preview}
      </div>
      <div style={{
        marginTop: 8,
        display: "flex",
        gap: 8,
        color: "rgba(255,255,255,0.2)",
        fontSize: 9,
        fontFamily: "var(--font-mono)",
      }}>
        <span>{memory.retrieval_count} retrievals</span>
        <span>{memory.half_life_days}d half-life</span>
        <span>{memory.age_days}d old</span>
      </div>
    </div>
  );
}
