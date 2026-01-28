import React from "react";
import telegramLogo from "./telegram-logo.png";

export function TelegramIcon({ size = 24, className = "" }: { size?: number; className?: string }) {
  return (
    <img
      src={telegramLogo}
      width={size}
      height={size}
      alt="Telegram"
      className={className}
      style={{ objectFit: "contain" }}
    />
  );
}
