import React from "react";
import openaiLogo from "./openai-logo.svg";

export function OpenAIIcon({ size = 24, className = "" }: { size?: number; className?: string }) {
  return (
    <img
      src={openaiLogo}
      width={size}
      height={size}
      alt="OpenAI"
      className={className}
      style={{ objectFit: "contain" }}
    />
  );
}
