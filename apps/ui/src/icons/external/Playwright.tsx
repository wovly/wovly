import React from "react";
import playwrightLogo from "./playwright-logo.png";

export function PlaywrightIcon({ size = 24, className = "" }: { size?: number; className?: string }) {
  return (
    <img
      src={playwrightLogo}
      width={size}
      height={size}
      alt="Playwright"
      className={className}
      style={{ objectFit: "contain" }}
    />
  );
}
