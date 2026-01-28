import React from "react";
import tasksIcon from "./briefcase.svg";

export function TasksIcon({ size = 24, className = "" }: { size?: number; className?: string }) {
  return (
    <img
      src={tasksIcon}
      width={size}
      height={size}
      alt="Tasks"
      className={className}
      style={{ objectFit: "contain" }}
    />
  );
}
