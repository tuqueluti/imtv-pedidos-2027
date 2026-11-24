import React from 'react';

interface ImtvLogoProps {
  logoUrl: string | null;
  className?: string;
  href?: string;
  onClick?: (e: React.MouseEvent<HTMLAnchorElement>) => void;
  size?: 'sm' | 'md';
}

export function ImtvLogo({
  logoUrl,
  className = '',
  href = '/',
  onClick,
  size = 'md',
}: ImtvLogoProps) {
  const heightPx = size === 'sm' ? 24 : 30;

  return (
    <a
      href={href}
      onClick={onClick}
      className={`imtv-brand-slot ${className}`.trim()}
      aria-label="IMTV · Portal de Pedidos de Vídeo 2027"
    >
      {logoUrl ? (
        <img
          src={logoUrl}
          alt="IMTV"
          className="imtv-brand-img"
          style={{ height: `${heightPx}px` }}
        />
      ) : (
        <span className="imtv-brand-fallback">IMTV</span>
      )}
    </a>
  );
}
