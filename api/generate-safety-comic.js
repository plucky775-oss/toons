function normalizeModelName(value = "") {
  return String(value)
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/^IMAGE_MODEL\s*=\s*/i, "")
    .replace(/^models\//i, "")
    .replace(/\s+/g, "");
}

function getImageModelCandidates() {
  const requested = normalizeModelName(process.env.IMAGE_MODEL || "");

  return [...new Set([
    requested,
    "gemini-3.1-flash-lite-image",
    "gemini-3.1-flash-image",
    "gemini-2.5-flash-image"
  ].filter(Boolean))];
}

function isModelAvailabilityError(status, message = "") {
  return [400, 404].includes(status) &&
    /model|not found|not supported|unexpected model name format|available models/i.test(message);
}

function imageFromResponse(raw) {
  const candidates = Array.isArray(raw?.candidates) ? raw.candidates : [];

  for (const candidate of candidates) {
    const parts = Array.isArray(candidate?.content?.parts)
      ? candidate.content.parts
      : [];

    for (const part of parts) {
      const inline = part?.inlineData || part?.inline_data;
      if (inline?.data) {
        return {
          data: inline.data,
          mimeType:
            inline.mimeType ||
            inline.mime_type ||
            "image/png"
        };
      }
    }
  }

  return null;
}

function buildPrompt(education, injuryLevel) {
  const panels = education.storyboard
    .map((panel, index) => `${index + 1}컷 ${panel.title}
장면: ${panel.scene}
교육 포인트: ${panel.educationPoint}`)
    .join("\n\n");

  return `
Create one square 2x2 grid safety education comic containing exactly four panels.

The uploaded images, if present, are reference materials only.
Use the reference images to understand the worksite, equipment, clothing,
material shape, and accident context.
When references disagree, follow the confirmed storyboard and never guess.

PRIVACY:
- Do not reproduce names, phone numbers, addresses, document text, logos,
  company names, license plates, or other identifying information.

STRICT FACTUAL RULES:
- Use only the people, objects, equipment, actions, and accident sequence
  explicitly described in the storyboard.
- Never add a crane, vehicle, utility pole collapse, explosion, extra worker,
  fall, fire, or PPE unless explicitly described.
- Keep the subject of each action exact.
- Do not change a person falling into an object falling.
- If a detail is unspecified, use a neutral composition that does not assert it.
- Keep the same characters, clothing, worksite, weather, material, and equipment
  consistent across all four panels.

VISUAL STYLE:
- clean professional Korean industrial safety webtoon
- realistic worksite relationships with approachable educational illustration
- clear hazard relationships and expressive but natural poses
- non-graphic, no blood, no gore
- injury presentation level: ${injuryLevel}
- absolutely no written text of any language
- no Korean letters, no English letters, no numbers, no symbols used as labels
- no speech bubbles, no caption boxes, no title cards, no signs, no watermarks
- leave clean open space near the top and bottom of each panel for app overlays
- exact 2x2 layout with clear black panel borders
- use clearly different camera compositions in each panel:
  panel 1 wide establishing shot,
  panel 2 medium action shot,
  panel 3 close-up of the hazard or accident moment,
  panel 4 wide instructional shot showing all prevention measures
- panel 4 must visibly demonstrate the correct prevention measures

STORYBOARD:
${panels}

Title concept: ${education.title || ""}
One-line lesson: ${education.oneLineLesson || ""}

Return one image only.
`;
}

async function requestImage(apiKey, model, parts, includeImageSize) {
  const imageConfig = {
    aspectRatio: "1:1"
  };

  // Gemini 3 image models support explicit image size.
  if (includeImageSize) {
    imageConfig.imageSize = "1K";
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: {
        "x-goog-api-key": apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: {
          responseModalities: ["IMAGE"],
          imageConfig
        }
      })
    }
  );

  const raw = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(
      raw?.error?.message || `Image API HTTP ${response.status}`
    );
    error.status = response.status;
    throw error;
  }

  const image = imageFromResponse(raw);
  if (!image) {
    throw new Error("이미지 응답에서 그림 데이터를 찾지 못했습니다.");
  }

  return image;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey =
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY;

  if (!apiKey) {
    return res.status(503).json({
      error: "GEMINI_API_KEY가 없습니다."
    });
  }

  const {
    sourceImages,
    education,
    injuryLevel
  } = req.body || {};

  if (
    !education ||
    !Array.isArray(education.storyboard) ||
    education.storyboard.length !== 4
  ) {
    return res.status(400).json({
      error: "정확히 4개의 스토리보드가 필요합니다."
    });
  }

  const parts = [];
  const references = Array.isArray(sourceImages)
    ? sourceImages.slice(0, 3)
    : [];

  for (const image of references) {
    if (image?.data && image?.mimeType) {
      parts.push({
        text: `Reference image ${image.order || ""}: ${
          image.name || "uploaded safety material"
        }`
      });
      parts.push({
        inlineData: {
          mimeType: image.mimeType,
          data: image.data
        }
      });
    }
  }

  parts.push({
    text: buildPrompt(education, injuryLevel || "mild")
  });

  const candidates = getImageModelCandidates();
  let lastError;

  for (const model of candidates) {
    try {
      const image = await requestImage(
        apiKey,
        model,
        parts,
        model.startsWith("gemini-3.")
      );

      return res.status(200).json({
        imageDataUrl: `data:${image.mimeType};base64,${image.data}`,
        model,
        apiVersion: "v1"
      });
    } catch (error) {
      lastError = error;
      console.error(`Image generation failed with ${model}:`, error.message);

      if (!isModelAvailabilityError(error.status, error.message)) {
        break;
      }
    }
  }

  return res.status(lastError?.status || 502).json({
    error:
      lastError?.message ||
      "사용 가능한 이미지 생성 모델을 찾지 못했습니다.",
    attemptedModels: candidates
  });
}
