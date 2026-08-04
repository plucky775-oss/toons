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
  const compositionGuides = [
    "Show the whole work area and all confirmed participants from a distant viewpoint.",
    "Show the worker and the confirmed equipment from a moderately close viewpoint.",
    "Show the confirmed hazardous contact or accident action prominently without labels.",
    "Show the same whole work area with corrected behavior only, without adding anything."
  ];

  const panels = education.storyboard
    .map((panel, index) => `Panel ${index + 1} visual scene only:
${panel.scene}
Composition instruction: ${compositionGuides[index]}`)
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


ENGINEERING GEOMETRY AND HUMAN-OBJECT CONTACT:
- A bucket truck boom must form one continuous mechanical chain:
  truck turntable -> lower boom -> upper boom -> bucket mounting point -> bucket.
- The boom must never connect to, end at, penetrate, or visually merge with a worker's body.
- The worker must remain inside the bucket unless explicitly approved.
- Never show direct hand contact with a conductor unless explicitly confirmed.
- Reproduce the exact confirmed contact body part. If the report says left shoulder,
  only the left shoulder may contact the conductor.
- Conductors must remain continuous and attached to their existing poles and crossarms.

CLOSED-WORLD INSTALLATION BAN:
- The approved report, reference images, user answers, and storyboard are the entire world.
- No new object, facility, protective installation, worker, vehicle, tool, PPE, sign,
  cone, barrier, line hose, insulating cover, protective tube, blanket, net, or guard may appear
  unless explicitly confirmed.
- Do not visualize a recommended control by inventing equipment.
- Show work stoppage, safe separation, corrected bucket position, or corrected behavior instead.

PANEL CONTINUITY:
- All panels must use the same site, truck, boom type, bucket, poles, conductor count,
  trees, road, weather, and worker count.
- Panel 4 is the same worksite with safer behavior, not a redesigned worksite.

INJURY PRESENTATION:
- mild: restrained educational depiction, mild spark.
- realistic: realistic contact posture, visible electrical spark or arc, credible shock reaction,
  serious facial expression; no blood or gore.
- strong_realistic: intense but non-gory electrical arc, smoke, strong muscular reaction,
  pain expression; no blood, exposed injury, dismemberment, or gore.
- omit: do not show direct contact; show the preceding hazard and work stoppage.

TEXT BAN:
- Generate illustration only.
- No letters, words, pseudo-writing, numbers, speech bubbles, captions, labels, signs,
  camera names, panel names, sound effects, watermarks, or logos.


STRICT CLOSED-WORLD EVIDENCE RULES:
Treat the accident report, uploaded reference images, confirmed user answers,
and approved storyboard as a CLOSED WORLD.

- Draw only people, objects, equipment, facilities, protective devices,
  vehicles, tools, PPE, and environmental features explicitly present in
  those approved sources.
- Anything not present in the approved sources must be treated as nonexistent.
- Do not invent, infer, recommend, install, attach, place, or visually add
  any new safety facility or equipment.
- Even when it would normally be a reasonable prevention measure, never add it
  unless the approved sources explicitly state that it was present or should
  be installed.

NEVER ADD UNLESS EXPLICITLY CONFIRMED:
- line hoses, insulating line covers, protective tubes, insulating blankets
- conductor covers, insulator covers, guarding covers, barriers, nets
- cones, barricades, signs, warning tape
- cranes, lifts, additional vehicles or tools
- extra workers, guides, signalers, spotters, supervisors
- additional PPE not confirmed in the approved sources
- any modification to poles, conductors, crossarms, buildings, roads, trees,
  or the original worksite layout

Panel 4 must preserve exactly the same worksite, conductors, poles, vehicle,
bucket, equipment, worker count, and surrounding environment as the accident scene.
Panel 4 may change only:
- worker behavior and posture
- work sequence
- use of PPE that already exists in the approved sources
- distance from energized parts
- stopping, postponing, or relocating the work within the same environment

If a prevention measure would require adding an unconfirmed object or facility,
do not show that object. Show safe distance, work stoppage, or corrected behavior instead.

- Keep the subject of every action exact.
- Do not change a person falling into an object falling.
- If a detail is unspecified, use a neutral composition that does not assert it.
- Keep the same characters, clothing, worksite, weather, material, equipment,
  vehicle, and infrastructure consistent across all four panels.

VISUAL STYLE:
- clean professional Korean industrial safety webtoon
- realistic worksite relationships with approachable educational illustration
- clear hazard relationships and expressive but natural poses
- non-graphic, no blood, no gore
- injury presentation level: ${injuryLevel}
- OUTPUT ARTWORK ONLY. Do not render any instruction words.
- absolutely no written text of any language anywhere in the image
- no Korean, English, pseudo-text, gibberish, letters, words, numbers, labels, symbols, or typography
- do not write panel names, scene names, camera terms, safety terms, sound effects, or headings
- no speech bubbles, caption boxes, title cards, signs, posters, documents, screens, or watermarks
- any visible paper, clipboard, monitor, sign, or vehicle marking must be completely blank
- reserve plain uncluttered visual space near the top and bottom of each panel
- exact 2x2 layout with clear black panel borders
- vary the visual distance by composition only; never display composition instructions as text
- panel 4 must demonstrate prevention only through evidence-approved behavior,
  existing PPE, safe distance, correct sequence, or work stoppage
- panel 4 must not install or introduce any new facility, cover, barrier,
  protective tube, worker, vehicle, or device

STORYBOARD:
${panels}

Do not include the title, lesson, storyboard headings, dialogue, or educational text in the artwork.
The application will add all wording after image generation.

Return one image containing artwork only.
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


function analysisModelCandidates(){
  const requested = String(process.env.ANALYSIS_MODEL || process.env.GEMMA_MODEL || "")
    .trim().replace(/^models\//i,"").replace(/^["']|["']$/g,"");
  return [...new Set([requested,"gemini-3.1-flash-lite","gemini-2.5-flash-lite","gemini-2.5-flash"].filter(Boolean))];
}

function verificationPrompt(education){
  const panels = education.storyboard.map((panel,index)=>`${index+1}. ${panel.scene}`).join("\n");
  return `
You are a strict industrial-safety image inspector.

APPROVED PANELS:
${panels}

FAIL if any are visible:
- direct conductor contact not explicitly approved
- wrong contact body part
- bucket-truck boom not continuously connected from truck to bucket
- boom connected to, crossing, entering, or ending at a worker's body
- worker outside or intersecting the bucket without approval
- unapproved equipment, protection, barriers, cones, covers, vehicles, workers, spotters, or PPE
- changed worksite, conductor count, truck, boom, or bucket between panels
- text, letters, labels, numbers, speech bubbles, captions, or pseudo-writing

Output exactly:
[VERDICT]
PASS
or
[VERDICT]
FAIL

[VIOLATIONS]
- short concrete violation
`;
}

function parseVerification(text=""){
  const verdict = text.match(/\[VERDICT\]\s*(PASS|FAIL)/i)?.[1]?.toUpperCase() || "FAIL";
  const block = text.match(/\[VIOLATIONS\]\s*([\s\S]*)/i)?.[1] || "";
  const violations = block.split(/\r?\n/).map(line=>line.replace(/^[\s\-•*]+/,"").trim()).filter(Boolean).slice(0,8);
  return {pass:verdict==="PASS",violations};
}

async function verifyGeneratedImage(apiKey,image,education){
  let lastError;
  for(const model of analysisModelCandidates()){
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          contents:[{role:"user",parts:[
            {inlineData:{mimeType:image.mimeType,data:image.data}},
            {text:verificationPrompt(education)}
          ]}],
          generationConfig:{temperature:0,maxOutputTokens:700}
        })
      }
    );
    const raw = await response.json().catch(()=>({}));
    if(response.ok){
      const text = raw?.candidates?.[0]?.content?.parts?.map(part=>part?.text||"").join("") || "";
      return {...parseVerification(text),model};
    }
    const message = raw?.error?.message || `Verification API ${response.status}`;
    lastError = new Error(message);
    if(![400,404].includes(response.status)) throw lastError;
  }
  throw lastError || new Error("이미지 검증 모델을 사용할 수 없습니다.");
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

      let finalImage = image;
      let verification = null;
      let regenerated = false;

      try{
        verification = await verifyGeneratedImage(apiKey,finalImage,education);
        if(!verification.pass){
          const correctionText = `
The first image failed factual and engineering verification.

VISIBLE VIOLATIONS:
${verification.violations.map(item=>`- ${item}`).join("\n")}

Regenerate the complete 2x2 comic once.
Correct every violation.
Do not add new objects or safety installations.
Preserve the approved storyboard and closed-world rules.
Illustration only; absolutely no text.
`;
          const correctedParts = [...parts,{text:correctionText}];
          finalImage = await requestImage(apiKey,model,correctedParts,model.startsWith("gemini-3."));
          regenerated = true;
          verification = await verifyGeneratedImage(apiKey,finalImage,education);
        }
      }catch(error){
        console.error("Image verification skipped:",error.message);
        verification = {pass:false,violations:["자동 검증을 완료하지 못했습니다."],skipped:true};
      }

      return res.status(200).json({
        imageDataUrl:`data:${finalImage.mimeType};base64,${finalImage.data}`,
        model,
        apiVersion:"v1",
        regenerated,
        verification
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
