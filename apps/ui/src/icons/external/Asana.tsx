import asanaLogo from "./asana-logo.png";

export function AsanaIcon({ size = 24, className = "" }: { size?: number; className?: string }) {
  return (
    <img 
      src={asanaLogo} 
      alt="Asana" 
      width={size} 
      height={size} 
      className={className}
      style={{ objectFit: "contain" }}
    />
  );
}
