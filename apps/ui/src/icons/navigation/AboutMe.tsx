import React from "react";
import mePng from "./me.png";

export function AboutMeIcon({ size = 24, className = "" }: { size?: number; className?: string }) {
  return (
    <img
      src={mePng}
      width={size}
      height={size}
      className={className}
      alt="About Me"
      style={{ objectFit: "contain" }}
    />
  );
}
