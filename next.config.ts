import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "cdn.discordapp.com" },
    ],
  },
  // @napi-rs/canvas ships a native .node addon loaded via a small JS shim
  // (js-binding.js) — Turbopack tries to bundle that shim as an ESM chunk
  // and fails ("non-ecmascript placeable asset"). Marking it external makes
  // the party-board-image server action `require()` it natively at runtime
  // instead, same as Next's own built-in list already does for "canvas".
  serverExternalPackages: ["@napi-rs/canvas"],
};

export default nextConfig;
