import logoutLogo from "./log-out.svg";

export function LogoutIcon({ size = 24, className = "" }: { size?: number; className?: string }) {
  return (
    <img 
      src={logoutLogo} 
      alt="Logout" 
      width={size} 
      height={size} 
      className={className}
      style={{ objectFit: "contain" }}
    />
  );
}
