import dns from "node:dns/promises";
import net from "node:net";

function isPrivateIp(ip){
  if(net.isIP(ip) === 4){
    const parts = ip.split(".").map(Number);
    return parts[0] === 10 ||
      parts[0] === 127 ||
      (parts[0] === 169 && parts[1] === 254) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168) ||
      parts[0] === 0;
  }
  if(net.isIP(ip) === 6){
    const value = ip.toLowerCase();
    return value === "::1" || value.startsWith("fc") || value.startsWith("fd") || value.startsWith("fe80:");
  }
  return true;
}

function decodeEntities(text=""){
  return text
    .replace(/&nbsp;/gi," ")
    .replace(/&amp;/gi,"&")
    .replace(/&quot;/gi,'"')
    .replace(/&#39;/gi,"'")
    .replace(/&lt;/gi,"<")
    .replace(/&gt;/gi,">")
    .replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(Number(n)));
}

function meta(html, property){
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']+)["']`,"i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${property}["']`,"i"),
    new RegExp(`<meta[^>]+name=["']${property}["'][^>]+content=["']([^"']+)["']`,"i")
  ];
  for(const pattern of patterns){
    const match = html.match(pattern);
    if(match?.[1]) return decodeEntities(match[1].trim());
  }
  return "";
}

function extractText(html){
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi," ")
      .replace(/<style[\s\S]*?<\/style>/gi," ")
      .replace(/<nav[\s\S]*?<\/nav>/gi," ")
      .replace(/<footer[\s\S]*?<\/footer>/gi," ")
      .replace(/<aside[\s\S]*?<\/aside>/gi," ")
      .replace(/<[^>]+>/g," ")
      .replace(/\s+/g," ")
  ).trim().slice(0,12000);
}

export default async function handler(req,res){
  res.setHeader("Cache-Control","no-store");
  if(req.method !== "POST") return res.status(405).json({error:"Method not allowed"});

  try{
    const parsed = new URL(String(req.body?.url || "").trim());
    if(!["http:","https:"].includes(parsed.protocol)) throw new Error("HTTP 또는 HTTPS 링크만 가능합니다.");

    const addresses = await dns.lookup(parsed.hostname,{all:true});
    if(!addresses.length || addresses.some(item=>isPrivateIp(item.address))){
      throw new Error("접근할 수 없는 주소입니다.");
    }

    const controller = new AbortController();
    const timer = setTimeout(()=>controller.abort(),10000);
    const response = await fetch(parsed.toString(),{
      redirect:"follow",
      signal:controller.signal,
      headers:{
        "User-Agent":"Mozilla/5.0 IssueToonBot/1.0",
        "Accept":"text/html,application/xhtml+xml"
      }
    });
    clearTimeout(timer);

    if(!response.ok) throw new Error(`기사 서버 응답 오류 (${response.status})`);
    const type = response.headers.get("content-type") || "";
    if(!type.includes("text/html")) throw new Error("HTML 기사 링크만 지원합니다.");

    const html = (await response.text()).slice(0,1500000);
    const title = meta(html,"og:title") ||
      decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "기사");
    const description = meta(html,"og:description") || meta(html,"description");
    const text = extractText(html);

    if(text.length < 120) throw new Error("기사 본문을 충분히 읽지 못했습니다.");

    return res.status(200).json({
      url:parsed.toString(),
      title:title.slice(0,180),
      summary:(description || text.slice(0,420)).slice(0,500),
      text:text.slice(0,10000)
    });
  }catch(error){
    return res.status(400).json({error:error.message || "기사 읽기 실패"});
  }
}
