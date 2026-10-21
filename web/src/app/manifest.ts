import type { MetadataRoute } from "next";
import { THEME_COLOR } from "@/lib/theme";

/** Lets "Add to Home screen" open the app full-screen, like a native one. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ETF Advisor",
    short_name: "ETF Advisor",
    description: "Which ETF to buy next, and how many units.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f3f4f6",
    theme_color: THEME_COLOR.light,
    icons: [
      { src: "/icon/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon/512", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
