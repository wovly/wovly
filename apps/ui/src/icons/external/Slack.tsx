import React from "react";
import slackLogo from "./slack-logo.png";

export function SlackIcon({ size = 24, className = "" }: { size?: number; className?: string }) {
  return (
    <img
      src={slackLogo}
      width={size}
      height={size}
      alt="Slack"
      className={className}
      style={{ objectFit: "contain" }}
    />
  );
}
