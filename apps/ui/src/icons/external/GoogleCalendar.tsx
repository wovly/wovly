import React from "react";
import googleCalendarLogo from "./google-calender-logo.png"; // Note: filename has typo

export function GoogleCalendarIcon({ size = 24, className = "" }: { size?: number; className?: string }) {
  return (
    <img
      src={googleCalendarLogo}
      width={size}
      height={size}
      alt="Google Calendar"
      className={className}
      style={{ objectFit: "contain" }}
    />
  );
}
