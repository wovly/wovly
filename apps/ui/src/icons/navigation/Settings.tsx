import React from "react";
import settingsIcon from "./settings.svg";

export function SettingsIcon({ size = 24, className = "" }: { size?: number; className?: string }) {
  return (
    <img
      src={settingsIcon}
      width={size}
      height={size}
      alt="Settings"
      className={className}
      style={{ objectFit: "contain" }}
    />
  );
}
