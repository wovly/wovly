import React from "react";
import geminiLogo from "./gemini-logo.png";

export function GeminiIcon({ size = 24, className = "" }: { size?: number; className?: string }) {
  return (
    <img
      src={geminiLogo}
      width={size}
      height={size}
      alt="Gemini"
      className={className}
      style={{ objectFit: "contain" }}
    />
  );
}
