import archiveLogo from "./archive.svg";

export function DocsIcon({ size = 24, className = "" }: { size?: number; className?: string }) {
  return (
    <img 
      src={archiveLogo} 
      alt="Docs" 
      width={size} 
      height={size} 
      className={className}
      style={{ objectFit: "contain" }}
    />
  );
}
