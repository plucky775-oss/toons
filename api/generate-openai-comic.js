function buildOpenAIPrompt(education) {
  const panels = (education?.storyboard || [])
    .slice(0, 4)
    .map((panel, index) => `Panel ${index + 1}: ${panel.scene}`)
    .join("\n");

  return `
Create one square image containing an exact 2x2 grid of four industrial-safety comic panels.

APPROVED STORYBOARD:
${panels}

STRICT FACTUAL RULES:
- The report and approved storyboard are a closed world.
- Draw only confirmed people, equipment, vehicles, facilities, PPE, tools,
  conductors, poles, terrain, and actions.
- Do not invent or add protective equipment, workers, vehicles, signs,
  barriers, covers, line hoses, tools, or structures.
- Preserve the exact accident body part and action.
- Never show direct hand contact with an electrical conductor unless confirmed.
- Equipment must be mechanically plausible.
- A bucket-truck boom must continuously connect the truck turntable to the bucket.
- The boom must never connect to or pass through a worker's body.
- Keep the same worksite, equipment, worker identity, clothing, weather,
  conductor count, and surrounding environment across all panels.
- Panel 4 must show safer behavior in the same environment without adding equipment.

STYLE:
- professional Korean industrial-safety webtoon illustration
- realistic equipment geometry and natural human posture
- clearly readable accident sequence
- realistic but non-gory; no blood or exposed injury
- exact 2x2 grid, clear panel borders
- reserve uncluttered space near the upper part of each panel for an HTML speech bubble

TEXT PROHIBITION:
- Artwork only.
- No text, letters, numbers, pseudo-writing, captions, labels, speech bubbles,
  signs, sound effects, logos, watermarks, or typography.

Return one image only.
`;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(503).json({
      error: "OPENAI_API_KEY가 없습니다. Vercel 환경변수에 등록해주세요."
    });
  }

  const { education } = req.body || {};
  if (!education?.storyboard?.length) {
    return res.status(400).json({ error: "스토리보드가 필요합니다." });
  }

  const model = process.env.OPENAI_IMAGE_MODEL || "gpt-image-2";
  const quality = process.env.OPENAI_IMAGE_QUALITY || "medium";

  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      prompt: buildOpenAIPrompt(education),
      size: "1024x1024",
      quality,
      output_format: "png",
      n: 1
    })
  });

  const raw = await response.json().catch(() => ({}));

  if (!response.ok) {
    return res.status(response.status).json({
      error: raw?.error?.message || `OpenAI Image API ${response.status}`
    });
  }

  const item = raw?.data?.[0];
  if (!item?.b64_json && !item?.url) {
    return res.status(502).json({
      error: "OpenAI 이미지 응답에서 그림 데이터를 찾지 못했습니다."
    });
  }

  let imageDataUrl;
  if (item.b64_json) {
    imageDataUrl = `data:image/png;base64,${item.b64_json}`;
  } else {
    const imageResponse = await fetch(item.url);
    if (!imageResponse.ok) {
      return res.status(502).json({ error: "OpenAI 생성 이미지를 불러오지 못했습니다." });
    }
    const buffer = Buffer.from(await imageResponse.arrayBuffer());
    imageDataUrl = `data:image/png;base64,${buffer.toString("base64")}`;
  }

  return res.status(200).json({
    imageDataUrl,
    model,
    provider: "openai"
  });
}
