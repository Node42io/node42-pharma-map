import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      // Crustdata-hosted company logos
      { protocol: "https", hostname: "crustdata-media.s3.us-east-2.amazonaws.com" },
      // Pravatar fallback for contact avatars (will be replaced when person-photo
      // Crustdata pull completes)
      { protocol: "https", hostname: "i.pravatar.cc" },
    ],
  },
};

export default nextConfig;
