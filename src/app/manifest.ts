import type { MetadataRoute } from "next";

// Lets a member "เพิ่มไปหน้าจอโฮม" (add to home screen) from their phone's
// browser and get an app-like icon + launch experience instead of always
// opening through a browser tab — worth having given how much of this app
// is actually used from a phone.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Divine Guild Manager",
    short_name: "Divine",
    description: "Member management for the Divine guild (ROOC), synced with Discord.",
    start_url: "/",
    display: "standalone",
    background_color: "#09090b",
    theme_color: "#09090b",
    icons: [
      { src: "/icon.png", sizes: "192x192", type: "image/png" },
      { src: "/brand/divine-icon.png", sizes: "256x256", type: "image/png" },
    ],
  };
}
