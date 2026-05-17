import type { NextConfig } from "next";

// When STATIC_EXPORT=1 (set by the GitHub Pages workflow), build a fully static
// site. API routes (which need a Node runtime) are stripped before the build
// runs — see .github/workflows/pages.yml.
const isStaticExport = process.env.STATIC_EXPORT === "1";

// GitHub Pages serves the repo at /<repo-name>/ unless a custom domain is set.
// REPO_BASE_PATH is injected by the workflow.
const basePath = process.env.REPO_BASE_PATH || "";

const nextConfig: NextConfig = {
  ...(isStaticExport
    ? {
        output: "export",
        basePath: basePath || undefined,
        assetPrefix: basePath ? `${basePath}/` : undefined,
        trailingSlash: true,
        images: { unoptimized: true },
      }
    : {
        images: {
          remotePatterns: [
            // Crustdata-hosted company logos
            {
              protocol: "https",
              hostname: "crustdata-media.s3.us-east-2.amazonaws.com",
            },
            // Pravatar fallback for contact avatars
            { protocol: "https", hostname: "i.pravatar.cc" },
          ],
        },
      }),
};

export default nextConfig;
