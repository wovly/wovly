import React from "react";
import discordLogo from "./discord-logo.png";

export function DiscordIcon({ size = 24, className = "" }: { size?: number; className?: string }) {
  return (
    <img
      src={discordLogo}
      width={size}
      height={size}
      alt="Discord"
      className={className}
      style={{ objectFit: "contain" }}
    />
  );
}
