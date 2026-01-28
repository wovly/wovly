import React from "react";
import imessageLogo from "./imessage-logo.png";

export function IMessageIcon({ size = 24, className = "" }: { size?: number; className?: string }) {
  return (
    <img
      src={imessageLogo}
      width={size}
      height={size}
      alt="iMessage"
      className={className}
      style={{ objectFit: "contain" }}
    />
  );
}
