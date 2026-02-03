import redditLogo from "./reddit-logo.png";

export function RedditIcon({ size = 24, className = "" }: { size?: number; className?: string }) {
  return (
    <img 
      src={redditLogo} 
      alt="Reddit" 
      width={size} 
      height={size} 
      className={className}
      style={{ objectFit: "contain" }}
    />
  );
}
