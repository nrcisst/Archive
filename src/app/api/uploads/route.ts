import { saveImageUpload } from "@/lib/image-upload-cache";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { image_base64 } = body as { image_base64?: string };

    if (!image_base64) {
      return Response.json({ error: "Missing image data" }, { status: 400 });
    }

    const upload = saveImageUpload(image_base64);
    if (!upload) {
      return Response.json(
        { error: "Invalid or oversized image" },
        { status: 400 }
      );
    }

    console.log("[uploads] Image cached for audit", {
      byteLength: upload.byteLength,
      mimeType: upload.mimeType,
      expiresInMs: upload.expiresAt - Date.now(),
    });

    return Response.json({
      image_upload_id: upload.id,
      expires_at: upload.expiresAt,
    });
  } catch (error) {
    console.error("[uploads] Image pre-upload failed", error);
    return Response.json(
      { error: "Image upload failed" },
      { status: 500 }
    );
  }
}
