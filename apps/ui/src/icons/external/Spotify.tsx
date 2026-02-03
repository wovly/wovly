import spotifyLogo from "./spotify-logo.png";

export function SpotifyIcon({ size = 24, className = "" }: { size?: number; className?: string }) {
  return (
    <img 
      src={spotifyLogo} 
      alt="Spotify" 
      width={size} 
      height={size} 
      className={className}
      style={{ objectFit: "contain" }}
    />
  );
}
