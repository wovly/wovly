import React from "react";
import chatIcon from "./message-square.svg";

export function ChatIcon({ size = 24, className = "" }: { size?: number; className?: string }) {
  return (
    <img
      src={chatIcon}
      width={size}
      height={size}
      alt="Chat"
      className={className}
      style={{ objectFit: "contain" }}
    />
  );
}
