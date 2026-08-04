const IMAGE_MODEL = process.env.IMAGE_MODEL || "gemini-3.1-flash-lite-image";

function buildPrompt({title,issue,articleTitle,tone,panel,index}){
  return `
Create panel ${index + 1} of a four-panel Korean social-issue webtoon.

Shared visual style for all panels:
- clean, friendly Korean webtoon illustration
- simple rounded characters, expressive faces, crisp outlines
- soft colors, uncluttered background
- same main character in every panel: Korean office worker in their 30s, short dark hair, navy jacket, white shirt
- vertical comic panel composition, 3:4 aspect ratio
- no text, no letters, no captions, no speech bubbles, no logos, no watermark-like labels
- respectful and non-inflammatory depiction
- do not imitate a living artist or copyrighted character

Comic title: ${title || "Social issue comic"}
Article title: ${articleTitle || ""}
Issue: ${issue || ""}
Tone: ${tone || "empathetic"}
Panel scene: ${panel?.caption || ""}
Character emotion: ${panel?.mood || ""}
Location cue: ${panel?.place || ""}

Make the scene visually communicate the panel without adding written text.
`;
}

async function createImage(apiKey,prompt){
  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions",{
    method:"POST",
    headers:{
      "x-goog-api-key":apiKey,
      "Content-Type":"application/json"
    },
    body:JSON.stringify({
      model:IMAGE_MODEL,
      input:prompt,
      response_format:{
        type:"image",
        mime_type:"image/png",
        aspect_ratio:"3:4",
        image_size:"1K"
      }
    })
  });

  const raw = await response.json();
  if(!response.ok) throw new Error(raw?.error?.message || `Image API ${response.status}`);

  const image = raw?.output_image || raw?.outputs?.find?.(item=>item?.type==="image");
  const data = image?.data;
  const mime = image?.mime_type || "image/png";
  if(!data) throw new Error("이미지 데이터가 없습니다.");
  return `data:${mime};base64,${data}`;
}

export default async function handler(req,res){
  res.setHeader("Cache-Control","no-store");
  if(req.method !== "POST") return res.status(405).json({error:"Method not allowed"});

  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if(!apiKey) return res.status(503).json({error:"Google AI Studio API key is not configured"});

  const {title,issue,articleTitle,tone,panels} = req.body || {};
  if(!Array.isArray(panels) || panels.length !== 4){
    return res.status(400).json({error:"4개의 패널 정보가 필요합니다."});
  }

  try{
    const images = [];
    for(let index=0; index<4; index++){
      images.push(await createImage(
        apiKey,
        buildPrompt({title,issue,articleTitle,tone,panel:panels[index],index})
      ));
    }
    return res.status(200).json({images,model:IMAGE_MODEL});
  }catch(error){
    console.error(error);
    return res.status(502).json({error:error.message || "이미지 생성 실패"});
  }
}
