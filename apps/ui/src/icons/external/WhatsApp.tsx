import React from "react";
import whatsappLogo from "./whatsapp-logo.png";

export function WhatsAppIcon({ size = 24, className = "" }: { size?: number; className?: string }) {
  return (
    <img
      src={whatsappLogo}
      width={size}
      height={size}
      alt="WhatsApp"
      className={className}
      style={{ objectFit: "contain" }}
    />
  );
}
