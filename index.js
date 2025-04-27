// 最終版：修正群組標記 @Bot 正確回應版 index.js

import express from 'express';
import axios from 'axios';
import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';

const app = express();
app.use(express.json());

const CHANNEL_ACCESS_TOKEN = process.env.CHANNEL_ACCESS_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const BOT_USER_ID = process.env.BOT_USER_ID; // ✅ 新增 Bot自己的UserID
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

const MEMORY_FILE = './memory.json';

let memoryStore = {};

const GROUP_MEMORY_LIMIT = 5;
const USER_MEMORY_LIMIT = 10;

function loadMemory() {
  if (fs.existsSync(MEMORY_FILE)) {
    memoryStore = JSON.parse(fs.readFileSync(MEMORY_FILE));
  }
}

function saveMemory() {
  fs.writeFileSync(MEMORY_FILE, JSON.stringify(memoryStore, null, 2));
}

function cleanOldMessages(id) {
  const now = Date.now();
  if (memoryStore[id]) {
    memoryStore[id].history = memoryStore[id].history.filter(item => now - item.timestamp <= 24 * 60 * 60 * 1000);
  }
}

function limitHistorySize(id, limit) {
  if (memoryStore[id] && memoryStore[id].history.length > limit) {
    memoryStore[id].history = memoryStore[id].history.slice(-limit);
  }
}

loadMemory();

app.post('/webhook', async (req, res) => {
  const events = req.body.events;

  for (const event of events) {
    if (event.type === 'message' && (event.message.type === 'text' || event.message.type === 'image')) {
      const sourceType = event.source.type;
      const userId = event.source.userId;
      const groupId = event.source.groupId;
      const replyToken = event.replyToken;

      const id = sourceType === 'user' ? userId : groupId;
      const isGroup = sourceType === 'group' || sourceType === 'room';
      const maxHistory = isGroup ? GROUP_MEMORY_LIMIT : USER_MEMORY_LIMIT;

      if (!memoryStore[id]) {
        memoryStore[id] = { history: [] };
      }

      const userInput = event.message.type === 'text' ? event.message.text : '[圖片]';

      memoryStore[id].history.push({
        role: 'user',
        parts: userInput,
        timestamp: Date.now()
      });

      cleanOldMessages(id);
      limitHistorySize(id, maxHistory);
      saveMemory();

      const mentioned = event.message.mentioned?.mentions?.some(m => m.userId === BOT_USER_ID);

      if (sourceType === 'user' || (isGroup && mentioned)) {
        const reply = await askGemini(id);
        memoryStore[id].history.push({
          role: 'model',
          parts: reply,
          timestamp: Date.now()
        });
        cleanOldMessages(id);
        limitHistorySize(id, maxHistory);
        saveMemory();

        await replyToLine(replyToken, reply);
      }
    }
  }

  res.send('OK');
});

async function askGemini(id) {
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    const history = (memoryStore[id]?.history || []).map(m => ({ role: m.role, parts: [{ text: m.parts }] }));
    const chat = model.startChat({ history });

    const prompt = "請根據以上對話繼續回答，並加上一些表情符號 🎈✨。";
    const result = await chat.sendMessage(prompt);
    const text = result.response.text();

    return text;
  } catch (error) {
    console.error(error);
    return "抱歉，我現在有點忙碌呢 🫠";
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
