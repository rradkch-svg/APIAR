import fs from "fs";
import path from "path";

const MIME_MAP: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

export async function GET(
  _req: Request,
  context: { params: Promise<{ path: string[] }> }
) {
  const { path: segments } = await context.params;
  if (!segments || segments.length === 0 || segments.length > 3) {
    return new Response("Not found", { status: 404 });
  }

  // Strictly prevent path traversal
  const cleanSegments = segments.map((s) => path.basename(s));
  const root = path.resolve(process.cwd(), ".vela-media");
  const fullPath = path.resolve(root, ...cleanSegments);
  if (!fullPath.startsWith(root) || !fs.existsSync(fullPath)) {
    return new Response("Not found", { status: 404 });
  }

  const ext = path.extname(fullPath).toLowerCase();
  const contentType = MIME_MAP[ext] || "application/octet-stream";
  const bytes = fs.readFileSync(fullPath);

  return new Response(bytes, {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(bytes.length),
      "Cache-Control": "public, max-age=31536000, immutable",
      "Accept-Ranges": "bytes",
    },
  });
}
