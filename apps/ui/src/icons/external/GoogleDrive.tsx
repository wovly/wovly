import React from "react";
import googleDriveLogo from "./google-drive-logo.png";

export function GoogleDriveIcon({ size = 24, className = "" }: { size?: number; className?: string }) {
  return (
    <img
      src={googleDriveLogo}
      width={size}
      height={size}
      alt="Google Drive"
      className={className}
      style={{ objectFit: "contain" }}
    />
  );
}
