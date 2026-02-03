import notionLogo from "./notion-logo.png";

export function NotionIcon({ size = 24, className = "" }: { size?: number; className?: string }) {
  return (
    <img 
      src={notionLogo} 
      alt="Notion" 
      width={size} 
      height={size} 
      className={className}
      style={{ objectFit: "contain" }}
    />
  );
}
