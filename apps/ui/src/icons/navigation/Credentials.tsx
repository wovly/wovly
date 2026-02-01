import React from "react";

export function CredentialsIcon({ size = 24, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* Key shape */}
      <path
        d="M21 2L19 4M19 4L22 7L19.5 9.5L16.5 6.5L19 4Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M16.5 6.5L11 12"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      {/* Lock body */}
      <circle
        cx="8"
        cy="15"
        r="5"
        stroke="currentColor"
        strokeWidth="2"
        fill="none"
      />
      <circle
        cx="8"
        cy="15"
        r="2"
        fill="currentColor"
      />
    </svg>
  );
}
