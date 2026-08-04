const $ = (s) => document.querySelector(s);
let articleContext = null;

function looksLikeUrl(value=""){
  try{
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:";
  }catch{
    return false;
  }
}

const palettes = [
  { shirt:"#5b8def", hair:"#2b2118", bg:"#dff3ff" },
  { shirt:"#ff8a65", hair:"#35271d", bg:"#fff0d7" },
  { shirt:"#66bb6a", hair:"#252525", bg:"#e8f6e8" },
  { shirt:"#ab7bea", hair:"#4a3022", bg:"#f1e9ff" }
];

function escapeHtml(text=""){
  return String(text).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[ch]));
}

function offlineScript(issue, tone, audience, ending){
  const short = issue.length > 42 ? issue.slice(0, 42) + "…" : issue;
  const toneLine = {
    "공감형":"나만 불편한 게 아니었구나.",
    "유머형":"편해진 건 알림창뿐이었다.",
    "풍자형":"규칙은 있는데, 퇴근은 없었다.",
    "정보형":"작은 관행도 반복되면 문화가 됩니다."
  }[tone] || "문제를 함께 바라봅니다.";

  const endLine = {
    "해결 메시지":"서로의 경계를 존중하는 작은 약속부터 시작해요.",
    "생각할 질문":"우리의 편리함은 누군가의 시간을 빼앗고 있진 않을까요?",
    "반전":"알림을 끈 순간, 진짜 대화가 시작됐습니다.",
    "공익 캠페인":"멈춰야 바뀝니다. 오늘부터 한 가지를 실천해요."
  }[ending];

  return {
    title: `${short} — 오늘의 이슈툰`,
    finalMessage: endLine,
    panels: [
      { dialogue:"요즘 이 문제가 자꾸 눈에 띄네.", caption:`상황: ${short}`, mood:"notice", place:"street" },
      { dialogue:"다들 익숙해서 그냥 넘기는 걸까?", caption:"불편함이 반복되면 일상이 됩니다.", mood:"worry", place:"office" },
      { dialogue:toneLine, caption:`${audience}의 시선으로 다시 보기`, mood:"realize", place:"meeting" },
      { dialogue:endLine, caption:"변화는 작은 선택에서 시작됩니다.", mood:"hope", place:"park" }
    ]
  };
}

async function aiScript(payload){
  const response = await fetch("/api/generate", {
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify(payload)
  });
  if(!response.ok) throw new Error("AI 요청 실패");
  return response.json();
}

async function analyzeArticle(url){
  const response = await fetch("/api/article",{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({url})
  });
  const result = await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(result?.error || "기사 읽기 실패");
  return result;
}

async function generatePanelImages(script, payload){
  const response = await fetch("/api/generate-images",{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({
      title:script.title,
      issue:payload.issue,
      articleTitle:payload.articleTitle,
      tone:payload.tone,
      panels:script.panels
    })
  });
  const result = await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(result?.error || "이미지 생성 실패");
  return result;
}

function characterSvg(index, mood, place){
  const p = palettes[index % palettes.length];
  const mouths = {
    notice:'M165 205 Q180 215 195 205',
    worry:'M165 216 Q180 202 195 216',
    realize:'M163 207 Q180 224 197 207',
    hope:'M160 202 Q180 224 200 202'
  };
  const brows = mood === "worry"
    ? '<path d="M145 172 l24 -7 M191 165 l24 7" stroke="#222" stroke-width="5" stroke-linecap="round"/>'
    : '<path d="M145 168 h24 M191 168 h24" stroke="#222" stroke-width="5" stroke-linecap="round"/>';

  const props = {
    street:'<rect x="0" y="285" width="360" height="115" fill="#d8dee9"/><rect x="35" y="240" width="70" height="80" rx="8" fill="#fff"/><circle cx="70" cy="275" r="15" fill="#ffcf33"/>',
    office:'<rect x="0" y="282" width="360" height="118" fill="#d9c7ae"/><rect x="235" y="240" width="95" height="70" rx="5" fill="#fff"/><rect x="246" y="251" width="73" height="42" fill="#bfe4ff"/>',
    meeting:'<rect x="0" y="285" width="360" height="115" fill="#e2d5c4"/><ellipse cx="180" cy="315" rx="145" ry="34" fill="#a06f45"/>',
    park:'<rect x="0" y="285" width="360" height="115" fill="#b8df9c"/><circle cx="60" cy="250" r="42" fill="#70b86c"/><rect x="55" y="255" width="10" height="55" fill="#75523a"/>'
  }[place];

  return `<svg viewBox="0 0 360 400" xmlns="http://www.w3.org/2000/svg">
    <rect width="360" height="400" fill="${p.bg}"/>
    <circle cx="300" cy="70" r="36" fill="#fff7b2" opacity=".9"/>
    ${props}
    <ellipse cx="180" cy="370" rx="70" ry="14" fill="#000" opacity=".12"/>
    <path d="M110 365 Q115 260 180 255 Q245 260 250 365" fill="${p.shirt}" stroke="#222" stroke-width="6"/>
    <circle cx="180" cy="180" r="68" fill="#ffd5b6" stroke="#222" stroke-width="6"/>
    <path d="M118 168 Q118 102 180 100 Q244 103 243 168 Q215 135 175 140 Q145 143 118 168" fill="${p.hair}" stroke="#222" stroke-width="6"/>
    ${brows}
    <circle cx="155" cy="185" r="6" fill="#222"/><circle cx="205" cy="185" r="6" fill="#222"/>
    <path d="${mouths[mood] || mouths.notice}" fill="none" stroke="#222" stroke-width="6" stroke-linecap="round"/>
    <path d="M128 286 Q85 300 78 340 M232 286 Q276 300 282 340" fill="none" stroke="#222" stroke-width="14" stroke-linecap="round"/>
    <circle cx="77" cy="344" r="12" fill="#ffd5b6" stroke="#222" stroke-width="4"/>
    <circle cx="283" cy="344" r="12" fill="#ffd5b6" stroke="#222" stroke-width="4"/>
  </svg>`;
}

function renderComic(data){
  $("#comicTitle").textContent = data.title || "오늘의 이슈툰";
  $("#finalMessage").textContent = data.finalMessage || "";
  const comic = $("#comic");
  comic.innerHTML = "";
  (data.panels || []).slice(0,4).forEach((panel, i) => {
    const node = $("#panelTemplate").content.cloneNode(true);
    node.querySelector(".panel-number").textContent = i + 1;
    const scene = node.querySelector(".scene");
    if(panel.imageDataUrl){
      scene.innerHTML = `<img src="${panel.imageDataUrl}" alt="${escapeHtml(panel.caption || `${i+1}컷 이미지`)}"><span class="image-credit">Google AI</span>`;
    }else{
      scene.innerHTML = characterSvg(i, panel.mood, panel.place);
    }
    node.querySelector(".bubble").textContent = panel.dialogue || "";
    node.querySelector(".caption").textContent = panel.caption || "";
    comic.appendChild(node);
  });
  $("#resultSection").classList.remove("hidden");
  $("#resultSection").scrollIntoView({behavior:"smooth", block:"start"});
}


$("#analyzeLinkBtn").addEventListener("click", async ()=>{
  const value = $("#issue").value.trim();
  if(!looksLikeUrl(value)){
    $("#status").textContent = "기사 URL을 입력해주세요.";
    return;
  }
  $("#analyzeLinkBtn").disabled = true;
  $("#status").textContent = "기사 내용을 읽고 있습니다…";
  try{
    articleContext = await analyzeArticle(value);
    $("#articleTitle").textContent = articleContext.title || "제목 확인 완료";
    $("#articleSummary").textContent = articleContext.summary || "기사 핵심 내용 확인 완료";
    $("#status").textContent = "기사 분석이 완료됐습니다.";
  }catch(error){
    articleContext = null;
    $("#articleTitle").textContent = "기사 읽기 실패";
    $("#articleSummary").textContent = error.message;
    $("#status").textContent = "기사 링크를 읽지 못했습니다. 직접 이슈를 입력해도 됩니다.";
  }finally{
    $("#analyzeLinkBtn").disabled = false;
  }
});

$("#generateBtn").addEventListener("click", async () => {
  const rawInput = $("#issue").value.trim();
  if(!rawInput){ $("#status").textContent = "기사 링크나 사회적 이슈를 입력해주세요."; return; }

  if(looksLikeUrl(rawInput) && (!articleContext || articleContext.url !== rawInput)){
    $("#status").textContent = "기사 링크를 먼저 읽고 있습니다…";
    try{
      articleContext = await analyzeArticle(rawInput);
      $("#articleTitle").textContent = articleContext.title || "제목 확인 완료";
      $("#articleSummary").textContent = articleContext.summary || "기사 분석 완료";
    }catch(error){
      articleContext = null;
    }
  }

  const payload = {
    issue: articleContext?.summary || rawInput,
    sourceUrl: articleContext?.url || (looksLikeUrl(rawInput) ? rawInput : ""),
    articleTitle: articleContext?.title || "",
    articleText: articleContext?.text || "",
    tone:$("#tone").value,
    audience:$("#audience").value,
    ending:$("#ending").value
  };
  $("#generateBtn").disabled = true;
  $("#status").textContent = "4컷 대본을 구성하고 있습니다…";
  try{
    let data;
    if($("#aiMode").checked){
      try{
        data = await aiScript(payload);
        const usedModel = data?.model || "gemma-4";
        $("#status").textContent = `Gemma 4 대본으로 완성했습니다. (${usedModel})`;
      }catch(e){
        data = offlineScript(payload.issue,payload.tone,payload.audience,payload.ending);
        $("#status").textContent = "Gemma 4 연결 실패로 오프라인 모드에서 완성했습니다.";
      }
    }else{
      data = offlineScript(payload.issue,payload.tone,payload.audience,payload.ending);
      $("#status").textContent = "오프라인 모드로 완성했습니다.";
    }

    if($("#imageAiMode").checked){
      $("#status").textContent = "Google AI Studio에서 4컷 그림을 생성하고 있습니다…";
      try{
        const imageResult = await generatePanelImages(data,payload);
        data.panels = data.panels.map((panel,index)=>({
          ...panel,
          imageDataUrl:imageResult.images?.[index] || null
        }));
        $("#status").textContent = `완성했습니다. 대본: ${data.model || "Gemma 4"} · 그림: ${imageResult.model || "Google AI"}`;
      }catch(error){
        $("#status").textContent = "이미지 API를 사용할 수 없어 무료 SVG 그림으로 완성했습니다.";
      }
    }

    renderComic(data);
  }finally{
    $("#generateBtn").disabled = false;
  }
});

$("#downloadBtn").addEventListener("click", async () => {
  const target = $("#resultSection");
  const canvas = await html2canvas(target,{scale:2,backgroundColor:"#f7f8fb"});
  const a = document.createElement("a");
  a.download = `이슈툰_${new Date().toISOString().slice(0,10)}.png`;
  a.href = canvas.toDataURL("image/png");
  a.click();
});

$("#resetBtn").addEventListener("click", () => {
  $("#issue").focus();
  window.scrollTo({top:0,behavior:"smooth"});
});

if("serviceWorker" in navigator){
  window.addEventListener("load",()=>navigator.serviceWorker.register("/sw.js"));
}
