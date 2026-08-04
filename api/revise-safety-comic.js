function normalizeModelName(value = "") {
  return String(value)
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/^IMAGE_MODEL\s*=\s*/i, "")
    .replace(/^models\//i, "")
    .replace(/\s+/g, "");
}

function imageModelCandidates() {
  const requested = normalizeModelName(process.env.IMAGE_MODEL || "");
  return [...new Set([
    requested,
    "gemini-3.1-flash-lite-image",
    "gemini-3.1-flash-image",
    "gemini-2.5-flash-image"
  ].filter(Boolean))];
}

function parseDataUrl(dataUrl = "") {
  const match = String(dataUrl).match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error("기존 만화 이미지 형식이 올바르지 않습니다.");
  return { mimeType: match[1], data: match[2] };
}

function imageFromResponse(raw) {
  for (const candidate of raw?.candidates || []) {
    for (const part of candidate?.content?.parts || []) {
      const inline = part?.inlineData || part?.inline_data;
      if (inline?.data) {
        return {
          data: inline.data,
          mimeType: inline.mimeType || inline.mime_type || "image/png"
        };
      }
    }
  }
  return null;
}

function buildRevisionPrompt(education, revisionNote) {
  const panels = (education?.storyboard || [])
    .map((panel, index) => `${index + 1}컷 장면: ${panel.scene}`)
    .join("\n");

  return `
Edit the provided existing 2x2 industrial safety comic.

USER REVISION REQUEST:
${revisionNote}

APPROVED STORYBOARD:
${panels}

EDITING RULES:
- Keep the same 2x2 panel structure.
- Keep the same worksite, workers, truck, boom, bucket, poles, conductors,
  trees, road, weather, and visual style unless the user specifically requests
  a correction to one of those elements.
- Correct only the requested visual errors.
- Do not rewrite the accident facts or change the approved sequence.
- The bucket truck boom must be one continuous mechanical chain from truck
  turntable to bucket mounting point and bucket.
- The boom must not connect to, penetrate, cross, or end at a worker's body.
- Never show direct hand contact with a conductor unless explicitly stated
  in the approved storyboard.
- Preserve the exact confirmed contact body part.
- Do not add any object, facility, PPE, worker, guide, signaler, vehicle,
  barrier, cone, sign, line hose, insulating cover, protective tube, or tool
  unless explicitly present in the approved storyboard or source references.
- Use realistic non-gory accident depiction: credible posture, electrical arc,
  shock reaction, and serious facial expression; no blood, exposed wounds,
  dismemberment, or gore.
- Illustration only.
- Absolutely no text, letters, numbers, pseudo-writing, speech bubbles,
  captions, labels, signs, sound effects, watermarks, or logos.

Return one corrected image only.
`;
}

async function requestRevision(apiKey, model, parts) {
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
          imageConfig: {
            aspectRatio: "1:1",
            ...(model.startsWith("gemini-3.") ? { imageSize: "1K" } : {})
          }
        }
      })
    }
  );

  const raw = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(raw?.error?.message || `Image revision API ${response.status}`);
    error.status = response.status;
    throw error;
  }

  const image = imageFromResponse(raw);
  if (!image) throw new Error("수정된 그림 데이터를 찾지 못했습니다.");
  return image;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: "GEMINI_API_KEY가 없습니다." });
  }

  const {
    currentImageDataUrl,
    education,
    revisionNote,
    sourceImages
  } = req.body || {};

  if (!currentImageDataUrl || !revisionNote || !education?.storyboard) {
    return res.status(400).json({ error: "수정할 그림, 스토리보드, 수정 지시가 필요합니다." });
  }

  const current = parseDataUrl(currentImageDataUrl);
  const parts = [
    { text: "Existing comic image to edit:" },
    { inlineData: { mimeType: current.mimeType, data: current.data } }
  ];

  for (const image of Array.isArray(sourceImages) ? sourceImages.slice(0, 3) : []) {
    if (image?.data && image?.mimeType) {
      parts.push({ text: `Original source reference ${image.order || ""}: ${image.name || ""}` });
      parts.push({ inlineData: { mimeType: image.mimeType, data: image.data } });
    }
  }

  parts.push({ text: buildRevisionPrompt(education, revisionNote) });

  let lastError;
  for (const model of imageModelCandidates()) {
    try {
      const image = await requestRevision(apiKey, model, parts);
      return res.status(200).json({
        imageDataUrl: `data:${image.mimeType};base64,${image.data}`,
        model,
        verification: { pass: true }
      });
    } catch (error) {
      lastError = error;
      if (![400, 404].includes(error.status)) break;
    }
  }

  return res.status(lastError?.status || 502).json({
    error: lastError?.message || "그림 수정에 실패했습니다."
  });
}
