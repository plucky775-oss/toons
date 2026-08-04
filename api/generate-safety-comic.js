const MODEL = process.env.IMAGE_MODEL || "gemini-3.1-flash-lite-image";

function imageFromResponse(raw){
  const parts=raw?.candidates?.[0]?.content?.parts||[];
  for(const part of parts){
    const inline=part.inlineData||part.inline_data;
    if(inline?.data) return {
      data:inline.data,
      mimeType:inline.mimeType||inline.mime_type||"image/png"
    };
  }
  return null;
}

export default async function handler(req,res){
  res.setHeader("Cache-Control","no-store");
  if(req.method!=="POST") return res.status(405).json({error:"Method not allowed"});
  const apiKey=process.env.GEMINI_API_KEY||process.env.GOOGLE_API_KEY;
  if(!apiKey) return res.status(503).json({error:"GEMINI_API_KEY가 없습니다."});

  const {sourceFile,education,injuryLevel}=req.body||{};
  if(!education?.storyboard?.length) return res.status(400).json({error:"스토리보드가 없습니다."});

  const parts=[];
  if(sourceFile?.data&&sourceFile?.mimeType){
    parts.push({inlineData:{mimeType:sourceFile.mimeType,data:sourceFile.data}});
  }

  const panels=education.storyboard.map((p,i)=>`${i+1}컷 ${p.title}
장면: ${p.scene}
교육 포인트: ${p.educationPoint}`).join("\n\n");

  parts.push({text:`
Create one square 2x2 grid safety education comic containing exactly four panels.

The uploaded image, if present, is reference material only. Reconstruct the work situation as a clean Korean industrial safety webtoon. Do not copy private names, document text, logos, phone numbers, addresses, or identifying details.

STRICT FACTUAL RULES:
- Use only the described people, objects, equipment, and accident sequence.
- Never add a crane, vehicle, utility pole collapse, explosion, extra worker, or PPE unless explicitly described.
- Keep the subject of each action exact. Do not change a person falling into an object falling.
- If a detail is unspecified, use a neutral composition that does not assert it.
- The same characters, clothing, worksite, weather, materials, and equipment must remain consistent in all four panels.

VISUAL STYLE:
- clean professional Korean safety webtoon
- realistic industrial worksite but approachable educational illustration
- expressive poses, clear hazard relationships
- non-graphic, no blood, no gore
- injury presentation level: ${injuryLevel}
- no speech bubbles, no captions, no written text, no numbers, no logos
- clear black panel borders, exact 2x2 layout
- panel 4 must visibly demonstrate correct prevention measures

STORYBOARD:
${panels}

Title concept: ${education.title}
One-line lesson: ${education.oneLineLesson}

Return IMAGE only.
`});

  try{
    const response=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent?key=${encodeURIComponent(apiKey)}`,{
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({
        contents:[{role:"user",parts}],
        generationConfig:{
          responseModalities:["IMAGE"],
          imageConfig:{aspectRatio:"1:1",imageSize:"1K"}
        }
      })
    });
    const raw=await response.json().catch(()=>({}));
    if(!response.ok) throw new Error(raw?.error?.message||`Image API ${response.status}`);
    const image=imageFromResponse(raw);
    if(!image) throw new Error("이미지 데이터를 찾지 못했습니다.");
    return res.status(200).json({
      imageDataUrl:`data:${image.mimeType};base64,${image.data}`,
      model:MODEL
    });
  }catch(error){
    return res.status(502).json({error:error.message||"이미지 생성 실패"});
  }
}
