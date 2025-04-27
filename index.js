// index.js 全新版 ✅✅✅

import express from "express";
import axios from "axios";
import { GoogleGenerativeAI } from "@google/generative-ai";

const app = express();
app.use(express.json());

const CHANNEL_ACCESS_TOKEN = process.env.CHANNEL_ACCESS_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const BOT_USER_ID = process.env.BOT_USER_ID; // 例如 @939byjko
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

const memory = {}; // 記憶體在這

app.post("/webhook", async (req, res) => {
  const events = req.body.events;

  for (const event of events) {
    if (event.type === "message" && event.message.type === "text") {
      const userMessage = event.message.text;
      const sourceType = event.source.type;
      const sourceId =
        sourceType === "user"
          ? event.source.userId
          : sourceType === "group"
          ? event.source.groupId
          : event.source.roomId;

      if (sourceType === "user") {
        // 私聊直接回應
        const reply = await askGemini(sourceId, userMessage);
        await replyToLine(event.replyToken, reply);
      }

      if (sourceType === "group" || sourceType === "room") {
        // 群組要被標記才回
        const mentioned = event.message.mentioned?.mentions?.some(
          (mention) => mention.userId === BOT_USER_ID
        );

        if (mentioned) {
          const cleanMessage = userMessage.replace(/@[^\s]+\s*/, "").trim();
          const reply = await askGemini(sourceId, cleanMessage);
          await replyToLine(event.replyToken, reply);
        }
      }
    }
  }

  res.send("OK");
});

async function askGemini(sourceId, message) {
  try {
    if (!memory[sourceId]) {
      memory[sourceId] = [];
    }

    const history = memory[sourceId];

    // 保證第一筆是 user
    if (history.length === 0 || history[0].role !== "user") {
      history.unshift({ role: "user", parts: [{ text: message }] });
    }

    history.push({ role: "user", parts: [{ text: message }] });

    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    const chat = model.startChat({ history });
    const result = await chat.sendMessage(message);
    const response = await result.response;
    const text = response.text();

    history.push({ role: "model", parts: [{ text }] });

    if (history.length > (sourceId.startsWith("U") ? 10 : 5)) {
      memory[sourceId] = history.slice(- (sourceId.startsWith("U") ? 10 : 5));
    }

    return text;
  } catch (error) {
    console.error(error);
    return "抱歉，我現在無法回應喔！";
  }
}

async function replyToLine(replyToken, message) {
  try {
    await axios.post(
      "https://api.line.me/v2/bot/message/reply",
      {
        replyToken,
        messages: [{
          type: "text",
          text: message,
        }]
      },
      {
        headers: {
          Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        }
      }
    );
  } catch (error) {
    console.error(error);
  }
}

app.listen(8080, () => {
  console.log("Server running on port 8080 \ud83d\ude80");
});
