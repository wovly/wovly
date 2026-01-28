import React from "react";
import integrationsIcon from "./minimize-2.svg";

export function IntegrationsIcon({ size = 24, className = "" }: { size?: number; className?: string }) {
  return (
    <img
      src={integrationsIcon}
      width={size}
      height={size}
      alt="Integrations"
      className={className}
      style={{ objectFit: "contain" }}
    />
  );
}
