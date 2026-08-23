import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Place photos are served from Google's CDN; the itinerary page renders them.
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "places.googleapis.com" },
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
    ],
  },
};

export default nextConfig;
