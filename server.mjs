import express from "express";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 3000);
const API_KEY = process.env.DASHSCOPE_API_KEY;
const API_URL = process.env.DASHSCOPE_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
const MODEL = process.env.DASHSCOPE_MODEL || "qwen-plus";

app.use(express.json({ limit: "32kb" }));

// Public static game page is hosted separately on GitHub Pages.
// This API intentionally accepts browser requests from any origin for a small classroom demo.
// For a public launch, restrict this to your exact GitHub Pages origin.
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOWED_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.get("/health", (_req, res) => res.json({ ok: true, service: "farm-advisor" }));

app.post("/api/farm-advisor", async (req, res) => {
  try {
    if (!API_KEY) return res.status(503).json({ error: "农事顾问服务尚未配置，请联系维护者。" });
    const question = typeof req.body?.question === "string" ? req.body.question.trim().slice(0, 1000) : "";
    const snapshot = req.body?.snapshot && typeof req.body.snapshot === "object" ? req.body.snapshot : {};
    if (!question) return res.status(400).json({ error: "请先输入问题。" });

    // Send only a bounded, read-only snapshot; never allow the model to mutate game state.
    const safeSnapshot = {
      farmName: String(snapshot.farmName || "").slice(0, 60),
      day: Number(snapshot.day || 1),
      season: String(snapshot.season || "").slice(0, 20),
      weather: String(snapshot.weather || "").slice(0, 30),
      forecast: Array.isArray(snapshot.forecast) ? snapshot.forecast.slice(0, 3).map(x => ({
        day: Number(x?.day || 0), weather: String(x?.weather || "").slice(0, 30)
      })) : [],
      plots: Array.isArray(snapshot.plots) ? snapshot.plots.slice(0, 6).map(p => ({
        name: String(p?.name || "").slice(0, 30),
        cultivar: String(p?.cultivar || "未播种").slice(0, 30),
        stage: Number(p?.stage ?? -1),
        stageDays: Number(p?.stageDays || 0),
        moisture: Number(p?.moisture || 0),
        water: Number(p?.water || 0),
        weeds: Number(p?.weeds || 0),
        pests: Number(p?.pests || 0),
        disease: Number(p?.disease || 0),
        lodging: Number(p?.lodging || 0),
        fertility: Number(p?.fertility || 0),
        health: Number(p?.health || 0),
        dead: Boolean(p?.dead)
      })) : [],
      inventory: snapshot.inventory && typeof snapshot.inventory === "object" ? snapshot.inventory : {},
      gold: Number(snapshot.gold || 0),
      harvestKg: Number(snapshot.harvestKg || 0)
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    let upstream;
    try {
      upstream = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: MODEL,
          temperature: 0.4,
          max_tokens: 700,
          messages: [
            { role: "system", content: "你是《禾小满的稻田守护日记》的农事科普顾问。请用简体中文回答，结合给出的只读游戏快照提出清晰、适合学生理解的种植建议和风险提醒。游戏数据是模拟值，不可当作现实农业的精确处方；必要时说明不确定性。你只能提供文本建议，不能修改游戏状态，不能声称已执行任何操作，不调用工具，不输出操控游戏的代码。涉及现实病虫害或农药时，提醒用户遵循当地农技人员意见、产品标签和当地规定。回答尽量简洁、分点。" },
            { role: "user", content: `只读农场快照：\n${JSON.stringify(safeSnapshot)}\n\n玩家问题：${question}` }
          ]
        }),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timer);
    }

    const payload = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      console.error("Model API returned status:", upstream.status);
      return res.status(502).json({ error: "农事顾问暂时无法回答，请稍后再试。" });
    }
    const answer = payload?.choices?.[0]?.message?.content;
    if (typeof answer !== "string" || !answer.trim()) {
      return res.status(502).json({ error: "农事顾问没有返回有效内容，请稍后再试。" });
    }
    res.json({ answer: answer.trim() });
  } catch (err) {
    console.error("Farm advisor request failed:", err?.name || "Error");
    if (err?.name === "AbortError") return res.status(504).json({ error: "农事顾问响应超时，请稍后重试。" });
    res.status(500).json({ error: "农事顾问暂时遇到问题，请稍后重试。" });
  }
});

app.listen(PORT, () => console.log(`Farm advisor backend listening on port ${PORT}`));
