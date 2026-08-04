export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  return res.status(200).json({
    analysisModel: process.env.ANALYSIS_MODEL || process.env.GEMMA_MODEL || "gemini-3.1-flash-lite",
    imageModel: process.env.IMAGE_MODEL || "gemini-3.1-flash-lite-image"
  });
}
