function normalizeModelName(value = "") {
  return String(value)
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/^ANALYSIS_MODEL\s*=\s*/i, "")
    .replace(/^models\//i, "")
    .replace(/\s+/g, "");
}

export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  return res.status(200).json({
    requestedAnalysisModel: normalizeModelName(
      process.env.ANALYSIS_MODEL || process.env.GEMMA_MODEL || ""
    ),
    defaultAnalysisModel: "gemini-2.5-flash-lite",
    fallbackAnalysisModel: "gemini-2.5-flash",
    imageModel:
      process.env.IMAGE_MODEL || "gemini-3.1-flash-lite-image"
  });
}
