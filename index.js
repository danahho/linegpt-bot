// index.js 雙向記憶＋表情版！
import express from 'express';
import axios from 'axios';
import fs from 'fs';
import { GoogleGenerativeAI } from "@google/generative-ai";

const app = express();
app.use(express.json());

const CHANNEL_ACCESS_TOKEN = process.env.CHANNEL_ACCESS_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// 記憶儲存路徑（在 Railway 上是暫存）
const MEMORY_FILE = './memory.json';
const MAX_MEMORY = 10; // 最多記 10 則對話

// 輔助函式：讀取記憶
function loadMemory() {
  try {
    const data = fs.readFileSync(MEMORY_FILE, 'utf8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

// 輔助函式：儲存記憶
function saveMemory(memory) {
  fs.writeFileSync(MEMORY_FILE, JSON.stringify(memory, null, 2));
}

app.post('/webhook', async (req, res) => {
  const events = req.body.events;

  for (const event of events) {
    if (event.type === 'message' && (event.message.type === 'text' || event.message.type === 'image')) {
      const userMessage = event.message.text || '[圖片]';
      const sourceType = event.source.type;
      const userId = event.source.userId;

      const memory = loadMemory();
      memory.push({ role: 'user', content: userMessage });
      if (memory.length > MAX_MEMORY) memory.shift();

      if (sourceType === 'user') {
        const reply = await askGemini(memory);
        memory.push({ role: 'bot', content: reply });
        saveMemory(memory);
        await replyToLine(event.replyToken, reply);
      }

      if (sourceType === 'group' || sourceType === 'room') {
        const mentioned = event.message.mentioned && event.message.mentioned.mentions && event.message.mentioned.mentions.length > 0;
        if (mentioned) {
          const reply = await askGemini(memory);
          memory.push({ role: 'bot', content: reply });
          saveMemory(memory);
          await replyToLine(event.replyToken, reply);
        }
      }
    }
  }

  res.send('OK');
});

async function askGemini(memory) {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    const chat = model.startChat({ history: memory.map(m => ({ role: m.role, parts: [{ text: m.content }] })) });
    const result = await chat.sendMessage('請根據以上對話回答我，並加上一些表情符號。');
    const response = await result.response;
    const text = response.text();
    return text;
  } catch (error) {
    console.error(error);
    return "抱歉😥，我現在無法回應喔。";
  }
}

async function replyToLine(replyToken, message) {
  try {
    await axios.post('https://api.line.me/v2/bot/message/reply', {
      replyToken,
      messages: [{
        type: 'text',
        text: message,
      }]
    }, {
      headers: {
        'Authorization': `Bearer ${CHANNEL_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error(error);
  }
}

app.listen(8080, () => {
  console.log('Server running on port 8080 🚀');
});
