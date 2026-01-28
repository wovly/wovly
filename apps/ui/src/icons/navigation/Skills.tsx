import React from "react";
import skillsIcon from "./book-open.svg";

export function SkillsIcon({ size = 24, className = "" }: { size?: number; className?: string }) {
  return (
    <img
      src={skillsIcon}
      width={size}
      height={size}
      alt="Skills"
      className={className}
      style={{ objectFit: "contain" }}
    />
  );
}
