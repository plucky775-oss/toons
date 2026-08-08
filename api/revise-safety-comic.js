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
  if (!match) throw new Error("수정할 컷 이미지 형식이 올바르지 않습니다.");
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

function buildRevisionPrompt(education, revisionPanel, revisionNote) {
  const panel = education?.storyboard?.[Number(revisionPanel) - 1] || {};

  return `
Edit the provided single industrial-safety comic panel.

THIS IMAGE IS PANEL ${revisionPanel} ONLY.
Return one single square panel, not a 2x2 comic and not multiple panels.

APPROVED PANEL FACTS:
Title concept: ${panel.title || ""}
Scene: ${panel.scene || ""}
Safety point: ${panel.educationPoint || ""}

USER REVISION REQUEST:
${revisionNote}

STRICT EDITING RULES:
- Correct only the user's requested visual problem.
- Preserve the panel's existing worksite, character identity, clothing, vehicle,
  bucket, boom type, poles, conductors, trees, road, weather, camera angle,
  illustration style, lighting, and overall composition unless the correction
  specifically requires changing one of them.
- Do not change the approved accident facts or sequence.
- A bucket-truck boom must remain one continuous mechanical chain:
  truck turntable -> lower boom -> upper boom -> bucket mounting point -> bucket.
- The boom must never connect to, penetrate, cross, or end at a worker's body.
- Never show direct hand contact with a conductor unless explicitly confirmed.
- Preserve the exact confirmed contact body part.
- Do not add any unconfirmed object, facility, PPE, worker, guide, signaler,
  vehicle, barrier, cone, sign, line hose, insulating cover, protective tube,
  blanket, guard, or tool.
- Use realistic non-gory accident depiction: credible posture, electrical arc,
  shock reaction, and serious facial expression; no blood, exposed wounds,
  dismemberment, or gore.
- Illustration only.
- Absolutely no text, letters, numbers, pseudo-writing, speech bubbles,
  captions, labels, signs, sound effects, borders, panel numbers, watermarks,
  or logos.
- Fill the full square canvas with the corrected illustration.

Return one corrected square image only.
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
    const error = new Error(
      raw?.error?.message || `Image revision API ${response.status}`
    );
    error.status = response.status;
    throw error;
  }

  const image = imageFromResponse(raw);
  if (!image) throw new Error("수정된 컷 그림 데이터를 찾지 못했습니다.");
  return image;
}


async function requestOpenAIRevision(apiKey, currentPanel, prompt) {
  const model = process.env.OPENAI_IMAGE_MODEL || "gpt-image-1.5";
  const form = new FormData();

  form.append("model", model);
  form.append("prompt", prompt);
  form.append("size", "1024x1024");
  form.append("quality", process.env.OPENAI_IMAGE_QUALITY || "medium");
  form.append("output_format", "png");

  const bytes = Buffer.from(currentPanel.data, "base64");
  form.append(
    "image",
    new Blob([bytes], { type: currentPanel.mimeType }),
    "panel.png"
  );

  const response = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}` },
    body: form
  });

  const raw = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(
      raw?.error?.message || `OpenAI Image Edit API ${response.status}`
    );
    error.status = response.status;
    throw error;
  }

  const item = raw?.data?.[0];
  if (!item?.b64_json && !item?.url) {
    throw new Error("OpenAI 수정 이미지 데이터를 찾지 못했습니다.");
  }

  if (item.b64_json) {
    return { data:item.b64_json, mimeType:"image/png", model };
  }

  const imageResponse = await fetch(item.url);
  if (!imageResponse.ok) throw new Error("OpenAI 수정 이미지를 불러오지 못했습니다.");
  const buffer = Buffer.from(await imageResponse.arrayBuffer());
  return { data:buffer.toString("base64"), mimeType:"image/png", model };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const {
    currentPanelDataUrl,
    education,
    revisionPanel,
    revisionNote,
    provider,
    sourceImages
  } = req.body || {};

  const selectedProvider = provider === "openai" ? "openai" : "gemini";
  const apiKey = selectedProvider === "openai"
    ? process.env.OPENAI_API_KEY
    : (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);

  if (!apiKey) {
    return res.status(503).json({
      error: selectedProvider === "openai"
        ? "OPENAI_API_KEY가 없습니다."
        : "GEMINI_API_KEY가 없습니다."
    });
  }

  if (
    !currentPanelDataUrl ||
    !revisionNote ||
    !education?.storyboard ||
    ![1, 2, 3, 4].includes(Number(revisionPanel))
  ) {
    return res.status(400).json({
      error: "수정할 컷, 스토리보드, 컷 번호와 수정 지시가 필요합니다."
    });
  }

  const currentPanel = parseDataUrl(currentPanelDataUrl);
  const parts = [
    { text: `Existing panel ${revisionPanel} to edit:` },
    {
      inlineData: {
        mimeType: currentPanel.mimeType,
        data: currentPanel.data
      }
    }
  ];

  for (
    const reference of Array.isArray(sourceImages)
      ? sourceImages.slice(0, 3)
      : []
  ) {
    if (reference?.data && reference?.mimeType) {
      parts.push({
        text: `Original source reference ${reference.order || ""}: ${
          reference.name || ""
        }`
      });
      parts.push({
        inlineData: {
          mimeType: reference.mimeType,
          data: reference.data
        }
      });
    }
  }

  parts.push({
    text: buildRevisionPrompt(
      education,
      Number(revisionPanel),
      revisionNote
    )
  });

  if (selectedProvider === "openai") {
    try {
      const image = await requestOpenAIRevision(
        apiKey,
        currentPanel,
        buildRevisionPrompt(education, Number(revisionPanel), revisionNote)
      );

      return res.status(200).json({
        panelImageDataUrl: `data:${image.mimeType};base64,${image.data}`,
        panel: Number(revisionPanel),
        model: image.model,
        provider: "openai"
      });
    } catch (error) {
      return res.status(error?.status || 502).json({
        error: error?.message || "OpenAI 선택 컷 수정에 실패했습니다."
      });
    }
  }

  let lastError;

  for (const model of imageModelCandidates()) {
    try {
      const image = await requestRevision(apiKey, model, parts);

      return res.status(200).json({
        panelImageDataUrl: `data:${image.mimeType};base64,${image.data}`,
        panel: Number(revisionPanel),
        model
      });
    } catch (error) {
      lastError = error;
      if (![400, 404].includes(error.status)) break;
    }
  }

  return res.status(lastError?.status || 502).json({
    error: lastError?.message || "선택한 컷 수정에 실패했습니다."
  });
}
