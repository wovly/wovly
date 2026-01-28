import React from "react";
import wovlyLogo from "./wovly-logo.png";

export function WovlyIcon({ size = 24, className = "" }: { size?: number; className?: string }) {
  return (
    <img
      src={wovlyLogo}
      width={size}
      height={size}
      alt="Wovly"
      className={className}
      style={{ objectFit: "contain" }}
    />
  );
}
