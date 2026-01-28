import React from "react";
import gmailLogo from "./gmail-logo.png";

export function GmailIcon({ size = 24, className = "" }: { size?: number; className?: string }) {
  return (
    <img
      src={gmailLogo}
      width={size}
      height={size}
      alt="Gmail"
      className={className}
      style={{ objectFit: "contain" }}
    />
  );
}
