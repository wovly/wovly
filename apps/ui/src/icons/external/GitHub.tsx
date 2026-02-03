import githubLogo from "./github-logo.svg";

export function GitHubIcon({ size = 24, className = "" }: { size?: number; className?: string }) {
  return (
    <img 
      src={githubLogo} 
      alt="GitHub" 
      width={size} 
      height={size} 
      className={className}
      style={{ objectFit: "contain" }}
    />
  );
}
