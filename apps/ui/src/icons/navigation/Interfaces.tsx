import React from "react";
import interfacesIcon from "./command.svg";

export function InterfacesIcon({ size = 24, className = "" }: { size?: number; className?: string }) {
  return (
    <img
      src={interfacesIcon}
      width={size}
      height={size}
      alt="Interfaces"
      className={className}
      style={{ objectFit: "contain" }}
    />
  );
}
