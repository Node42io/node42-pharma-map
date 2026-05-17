"use client";
import Image from "next/image";
import { useState } from "react";

function colorForName(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `hsl(${hue} 35% 28%)`;
}

function initials(name: string): string {
  return name
    .split(/[\s\-&]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
}

export function CompanyLogo({
  logoUrl,
  name,
  size = 32,
  className = "",
}: {
  logoUrl: string | null;
  name: string;
  size?: number;
  className?: string;
}) {
  const [errored, setErrored] = useState(false);
  const px = `${size}px`;
  if (!logoUrl || errored) {
    return (
      <div
        className={`shrink-0 grid place-items-center rounded-full text-white font-semibold text-[10px] ${className}`}
        style={{ width: px, height: px, backgroundColor: colorForName(name) }}
        aria-label={name}
      >
        {initials(name)}
      </div>
    );
  }
  return (
    <div
      className={`shrink-0 grid place-items-center rounded-full bg-white overflow-hidden ${className}`}
      style={{ width: px, height: px }}
    >
      <Image
        src={logoUrl}
        alt={name}
        width={size * 2}
        height={size * 2}
        unoptimized
        onError={() => setErrored(true)}
        className="object-contain"
        style={{ width: px, height: px }}
      />
    </div>
  );
}
