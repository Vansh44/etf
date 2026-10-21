import { ImageResponse } from "next/og";
import { RupeeGlyph } from "@/components/icons";

/**
 * The favicon plus the two sizes Android wants for "Add to Home screen"
 * (/icon/192 and /icon/512, listed in manifest.ts). The tile is full-bleed so
 * Android's own mask can shape it; only the tiny favicon gets corners.
 */

const ACCENT = "#2563c9";

export function generateImageMetadata() {
  return [32, 192, 512].map((px) => ({
    id: String(px),
    size: { width: px, height: px },
    contentType: "image/png",
  }));
}

export default async function Icon({ id }: { id: Promise<string> }) {
  const px = Number(await id);
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: ACCENT,
          borderRadius: px <= 32 ? 7 : 0,
        }}
      >
        <RupeeGlyph size={px * (px <= 32 ? 0.7 : 0.5)} color="#ffffff" />
      </div>
    ),
    { width: px, height: px },
  );
}
