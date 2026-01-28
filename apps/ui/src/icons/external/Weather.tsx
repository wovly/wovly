import React from "react";

export function WeatherIcon({ size = 24, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="12" cy="12" r="4" fill="#FFB300"/>
      <path d="M12 2V4M12 20V22M2 12H4M20 12H22" stroke="#FFB300" strokeWidth="2" strokeLinecap="round"/>
      <path d="M4.93 4.93L6.34 6.34M17.66 17.66L19.07 19.07M4.93 19.07L6.34 17.66M17.66 6.34L19.07 4.93" stroke="#FFB300" strokeWidth="2" strokeLinecap="round"/>
      <path d="M16 16C16 18.209 14.209 20 12 20C8.5 20 6 17.5 6 14.5C6 12.5 7.5 11 9 10C10.5 9 11.5 8.5 12 7C12.5 8.5 14 10.5 16 12C17 13 17 14.5 16 16Z" fill="#90CAF9" opacity="0.7"/>
    </svg>
  );
}
