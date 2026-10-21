import { ImageResponse } from "next/og";
import { RupeeGlyph } from "@/components/icons";

/** iOS home-screen icon. Square: iOS applies its own rounded mask. */

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#2563c9",
        }}
      >
        <RupeeGlyph size={96} color="#ffffff" />
      </div>
    ),
    size,
  );
}
