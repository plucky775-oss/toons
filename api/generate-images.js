const IMAGE_MODEL = process.env.IMAGE_MODEL || "gemini-3.1-flash-lite-image";

function buildPrompt({ title, issue, articleTitle, tone, panel, index }) {
  return `
Create panel ${index + 1} of a four-panel Korean social-issue webtoon.

Shared visual identity:
- clean and friendly Korean webtoon illustration
- one consistent main character in every panel:
  Korean office worker in their 30s, short dark hair, navy jacket, white shirt
- simple rounded shapes, expressive face, crisp dark outlines
- soft colors and uncluttered backgrounds
- portrait comic panel, 3:4 aspect ratio
- respectful, neutral, non-inflammatory visual treatment
- no text, no Korean letters, no captions, no speech bubbles
- no logos, news outlet marks, UI screenshots, or added watermark-like labels
- do not imitate a living artist or copyrighted character

Comic title: ${String(title || "Social issue comic").slice(0, 120)}
Article title: ${String(articleTitle || "").slice(0, 180)}
Issue summary: ${String(issue || "").slice(0, 1000)}
Tone: ${String(tone || "empathetic").slice(0, 40)}
Panel description: ${String(panel?.caption || "").slice(0, 300)}
Character emotion: ${String(panel?.mood || "").slice(0, 30)}
Location cue: ${String(panel?.place || "").slice(0, 30)}

Show the panel's meaning visually. Return one image only.
`;
}

function findImageBlock(raw) {
  if (raw?.output_image?.data) {
    return {
      data: raw.output_image.data,
      mimeType: raw.output_image.mime_type || "image/png"
    };
  }

  const steps = Array.isArray(raw?.steps) ? raw.steps : [];
  for (let i = steps.length - 1; i >= 0; i--) {
    const contents = Array.isArray(steps[i]?.content) ? steps[i].content : [];
    for (let j = contents.length - 1; j >= 0; j--) {
      const block = contents[j];
      if (block?.type === "image" && block?.data) {
        return {
          data: block.data,
          mimeType: block.mime_type || "image/png"
        };
      }
    }
  }

  const outputs = Array.isArray(raw?.outputs) ? raw.outputs : [];
  for (const output of outputs) {
    if (output?.type === "image" && output?.data) {
      return {
        data: output.data,
        mimeType: output.mime_type || "image/png"
      };
    }
  }

  return null;
}

async function createImage(apiKey, prompt) {
  const response = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/interactions",
    {
      method: "POST",
      headers: {
        "x-goog-api-key": apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: IMAGE_MODEL,
        input: [{ type: "text", text: prompt }],
        response_format: {
          type: "image",
          mime_type: "image/png",
          aspect_ratio: "3:4",
          image_size: "1024px"
        }
      })
    }
  );

  const raw = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(raw?.error?.message || `Image API HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }

  const image = findImageBlock(raw);
  if (!image?.data) {
    console.error("Unexpected image response:", JSON.stringify(raw).slice(0, 3000));
    throw new Error("Google AI 응답에서 이미지 데이터를 찾지 못했습니다.");
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
      error: "Vercel 환경변수 GEMINI_API_KEY가 설정되지 않았습니다."
    });
  }

  const { title, issue, articleTitle, tone, panels } = req.body || {};
  if (!Array.isArray(panels) || panels.length !== 4) {
    return res.status(400).json({ error: "4개의 패널 정보가 필요합니다." });
  }

  try {
    const images = [];
    for (let index = 0; index < 4; index++) {
      images.push(
        await createImage(
          apiKey,
          buildPrompt({
            title,
            issue,
            articleTitle,
            tone,
            panel: panels[index],
            index
          })
        )
      );
    }

    return res.status(200).json({
      images,
      model: IMAGE_MODEL,
      count: images.length
    });
  } catch (error) {
    console.error("Google image generation failed:", error);
    return res.status(error.status || 502).json({
      error: error.message || "이미지 생성 실패",
      model: IMAGE_MODEL
    });
  }
}
