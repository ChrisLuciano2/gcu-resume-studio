"use client";

export function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="btn-outline"
      style={{
        fontSize: 13,
        fontWeight: 500,
        padding: "8px 14px",
        border: "1px solid var(--line-strong)",
        background: "var(--white)",
        borderRadius: 4,
        cursor: "pointer",
      }}
    >
      Print / Save as PDF
    </button>
  );
}
