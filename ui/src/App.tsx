import { useState, useEffect } from "react";
import type { Memory, Stats, Conflict, EmbeddingIndex } from "./types.js";
import { fetchMemories, fetchStats, fetchConflicts, fetchEmbeddings } from "./api/client.js";
import { LivingMap } from "./views/LivingMap/LivingMap.js";

type LoadState = "loading" | "ready" | "error";

const loadingStyles = `
  @keyframes hippo-float {
    0%, 100% { transform: translateY(0px); opacity: 0.4; }
    50% { transform: translateY(-6px); opacity: 1; }
  }
  @keyframes hippo-dots {
    0% { content: ''; }
    33% { content: '.'; }
    66% { content: '..'; }
    100% { content: '...'; }
  }
`;

export function App() {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [embeddings, setEmbeddings] = useState<EmbeddingIndex>({});
  const [state, setState] = useState<LoadState>("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([fetchMemories(), fetchStats(), fetchConflicts(), fetchEmbeddings()])
      .then(([m, s, c, e]) => {
        setMemories(m);
        setStats(s);
        setConflicts(c);
        setEmbeddings(e);
        setState("ready");
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
        setState("error");
      });
  }, []);

  if (state === "loading") {
    return (
      <div style={centerStyle}>
        <style>{loadingStyles}</style>
        <div style={{ textAlign: "center" }}>
          <div style={{
            fontSize: 32,
            animation: "hippo-float 2.5s ease-in-out infinite",
            marginBottom: 16,
            filter: "saturate(0.7)",
          }}>
            🧠
          </div>
          <div style={{
            color: "rgba(255,255,255,0.2)",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            letterSpacing: "2px",
          }}>
            loading memories
          </div>
        </div>
      </div>
    );
  }

  if (state === "error") {
    return (
      <div style={centerStyle}>
        <div style={{ textAlign: "center", maxWidth: 320 }}>
          <div style={{
            color: "var(--red)",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            marginBottom: 8,
          }}>
            {error}
          </div>
          <div style={{
            color: "rgba(255,255,255,0.15)",
            fontSize: 10,
            fontFamily: "var(--font-mono)",
          }}>
            is hippo dashboard running?
          </div>
        </div>
      </div>
    );
  }

  if (memories.length === 0) {
    return (
      <div style={centerStyle}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 32, marginBottom: 16, opacity: 0.5 }}>🧠</div>
          <div style={{
            color: "rgba(255,255,255,0.4)",
            fontSize: 12,
            fontFamily: "var(--font-mono)",
            marginBottom: 8,
          }}>
            no memories yet
          </div>
          <div style={{
            color: "rgba(255,255,255,0.15)",
            fontSize: 10,
            fontFamily: "var(--font-mono)",
          }}>
            run{" "}
            <span style={{ color: "var(--accent)" }}>hippo remember</span>
            {" "}to begin
          </div>
        </div>
      </div>
    );
  }

  return <LivingMap memories={memories} embeddings={embeddings} stats={stats} conflicts={conflicts} />;
}

const centerStyle: React.CSSProperties = {
  width: "100%",
  height: "100%",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};
