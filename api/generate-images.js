const IMAGE_MODEL = process.env.IMAGE_MODEL || "imagen-4.0-generate-001";

function buildPrompt({ title, issue, articleTitle, tone, panel, index }) {
  return `
Create panel ${index + 1} of a four-panel Korean social-issue webtoon.

Visual consistency:
- clean Korean webtoon illustration
- same main character in every panel
- Korean adult office worker in their 30s
- short dark hair, navy jacket, white shirt
- rounded facial features, expressive emotion
- crisp dark outlines, soft colors
- simple background, portrait 3:4 composition
- no written text, no letters, no speech bubbles
- no logos, UI screenshots, or news outlet branding
- respectful and non-inflammatory portrayal
- do not imitate a living artist or copyrighted character

Comic title: ${String(title || "").slice(0, 120)}
Article title: ${String(articleTitle || "").slice(0, 180)}
Issue summary: ${String(issue || "").slice(0, 800)}
Tone: ${String(tone || "empathetic").slice(0, 40)}
Panel scene: ${String(panel?.caption || "").slice(0, 250)}
Emotion: ${String(panel?.mood || "").slice(0, 30)}
Location: ${String(panel?.place || "").slice(0, 30)}

Return one image only.
`;
}

function extractImage(raw) {
  const prediction = Array.isArray(raw?.predictions) ? raw.predictions[0] : null;

  const data =
    prediction?.bytesBase64Encoded ||
    prediction?.image?.imageBytes ||
    prediction?.imageBytes ||
    raw?.generatedImages?.[0]?.image?.imageBytes ||
    raw?.generated_images?.[0]?.image?.image_bytes;

  const mimeType =
    prediction?.mimeType ||
    prediction?.mime_type ||
    prediction?.image?.mimeType ||
    "image/png";

  return data ? { data, mimeType } : null;
}

async function createImage(apiKey, prompt) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(IMAGE_MODEL)}:predict`,
    {
      method: "POST",
      headers: {
        "x-goog-api-key": apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        instances: [
          {
            prompt
          }
        ],
        parameters: {
          sampleCount: 1,
          aspectRatio: "3:4",
          personGeneration: "allow_adult",
          imageSize: "1K"
        }
      })
    }
  );

  const raw = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(
      raw?.error?.message || `Imagen API HTTP ${response.status}`
    );
    error.status = response.status;
    throw error;
  }

  const image = extractImage(raw);

  if (!image?.data) {
    console.error(
      "Unexpected Imagen response:",
      JSON.stringify(raw).slice(0, 3000)
    );
    throw new Error("Imagen 응답에서 이미지 데이터를 찾지 못했습니다.");
  }

  return `data:${image.mimeType};base64,${image.data}`;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

  if (!apiKey) {
    return res.status(503).json({
      error: "Vercel 환경변수 GEMINI_API_KEY가 없습니다."
    });
  }

  const { title, issue, articleTitle, tone, panels } = req.body || {};

  if (!Array.isArray(panels) || panels.length !== 4) {
    return res.status(400).json({
      error: "4개의 패널 정보가 필요합니다."
    });
  }

  try {
    const images = [];

    // 프로젝트의 요청 제한에 덜 걸리도록 순차 생성
    for (let index = 0; index < 4; index++) {
      const prompt = buildPrompt({
        title,
        issue,
        articleTitle,
        tone,
        panel: panels[index],
        index
      });

      images.push(await createImage(apiKey, prompt));
    }

    return res.status(200).json({
      images,
      model: IMAGE_MODEL,
      count: images.length
    });
  } catch (error) {
    console.error("Imagen generation failed:", error);

    return res.status(error.status || 502).json({
      error: error.message || "Imagen 이미지 생성 실패",
      model: IMAGE_MODEL
    });
  }
}
