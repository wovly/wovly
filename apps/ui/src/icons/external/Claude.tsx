import React from "react";
import claudeLogo from "./claude-logo.svg";

export function ClaudeIcon({ size = 24, className = "" }: { size?: number; className?: string }) {
  return (
    <img
      src={claudeLogo}
      width={size}
      height={size}
      alt="Claude"
      className={className}
      style={{ objectFit: "contain" }}
    />
  );
}
