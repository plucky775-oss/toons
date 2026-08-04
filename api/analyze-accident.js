const MODEL = process.env.GEMMA_MODEL || "gemma-4-26b-a4b-it";

function extractJson(text=""){
  const cleaned = String(text).replace(/```json/gi,"").replace(/```/g,"").trim();
  try{return JSON.parse(cleaned)}catch{
    const start=cleaned.indexOf("{"), end=cleaned.lastIndexOf("}");
    if(start<0||end<=start) throw new Error("JSON 응답을 해석하지 못했습니다.");
    return JSON.parse(cleaned.slice(start,end+1));
  }
}

export default async function handler(req,res){
  res.setHeader("Cache-Control","no-store");
  if(req.method!=="POST") return res.status(405).json({error:"Method not allowed"});
  const apiKey=process.env.GEMINI_API_KEY||process.env.GOOGLE_API_KEY;
  if(!apiKey) return res.status(503).json({error:"GEMINI_API_KEY가 없습니다."});

  const {files,extraContext,educationUse}=req.body||{};
  const parts=[];
  const safeFiles=Array.isArray(files)?files.slice(0,8):[];
  for(const file of safeFiles){
    if(file?.data&&file?.mimeType){
      parts.push({text:`자료 ${file.order||""}: ${file.name||"이름 없음"}`});
      parts.push({inlineData:{mimeType:file.mimeType,data:file.data}});
    }
  }
  parts.push({text:`
너는 산업안전 사고조사 자료를 교육용으로 구조화하는 분석가다.

입력된 여러 자료를 순서대로 함께 비교하여 분석하라.
보고서 사진, 현장사진, 작업 전후 사진 사이의 공통점과 차이를 확인하되,
문서에 명시된 사실과 사진에서 직접 관찰되는 사실을 구분하라.
입력 자료를 읽고 보고서에 명시된 사실과 불명확한 사항을 엄격히 구분하라.
자료에 없는 사람, 장비, 행동, 사고결과를 절대 추측하거나 추가하지 마라.
특히 "사람이 넘어짐", "자재가 넘어짐", "전주가 넘어짐"처럼 주어를 임의로 바꾸지 마라.
문서의 문장이 모호하면 확정하지 말고 질문으로 만들어라.

보충 설명:
${String(extraContext||"없음").slice(0,2000)}
교육 용도: ${String(educationUse||"안전교육")}

JSON만 출력:
{
 "summary":"사고 개요 2~4문장",
 "workDescription":"작업 내용",
 "sequence":["시간 순서의 사고 경위"],
 "confirmedFacts":["자료에서 직접 확인되는 사실"],
 "sourceObservations":[
   {"source":"자료 번호 또는 파일명","observation":"직접 확인되는 내용","confidence":"높음|중간"}
 ],
 "causeCandidates":[
   {"name":"원인명","category":"관리적|기술적|인적|환경적","evidence":"자료상 근거"}
 ],
 "hazards":["위험요인"],
 "questions":[
   {"id":"q1","question":"만화 제작에 꼭 필요한 확인 질문","options":["선택지1","선택지2","기타/모름"]}
 ],
 "sensitiveDetails":["개인정보 또는 교육자료에서 가려야 할 내용"]
}

질문은 만화 장면의 사실 정확도에 꼭 필요한 것만 0~4개 작성하라.
사고 원인은 자료상 근거가 있는 후보만 제시하라.
`});

  try{
    const response=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent?key=${encodeURIComponent(apiKey)}`,{
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({
        contents:[{role:"user",parts}],
        generationConfig:{
          temperature:0.2,
          maxOutputTokens:2200,
          thinkingConfig:{thinkingLevel:"high"}
        }
      })
    });
    const raw=await response.json().catch(()=>({}));
    if(!response.ok) throw new Error(raw?.error?.message||`Gemma API ${response.status}`);
    const text=raw?.candidates?.[0]?.content?.parts?.map(p=>p.text||"").join("")||"";
    const data=extractJson(text);
    return res.status(200).json({...data,model:MODEL});
  }catch(error){
    return res.status(502).json({error:error.message||"사고 분석 실패"});
  }
}
