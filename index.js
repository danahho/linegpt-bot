// index.js
import express from 'express';
import axios from 'axios';
import { GoogleGenerativeAI } from "@google/generative-ai";
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

// 讀取環境變數
dotenv.config();

const app = express();
app.use(express.json());

const CHANNEL_ACCESS_TOKEN = process.env.CHANNEL_ACCESS_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const BOT_USER_ID = process.env.BOT_USER_ID;
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// 記憶體檔案
const memoryFile = path.resolve('memory.json');
let memory = fs.existsSync(memoryFile) ? JSON.parse(fs.readFileSync(memoryFile)) : {};

// 記憶保存時間（毫秒），這裡設 24 小時
const MEMORY_LIFESPAN = 24 * 60 * 60 * 1000;

function saveMemory() {
  fs.writeFileSync(memoryFile, JSON.stringify(memory));
}

function cleanOldMemory(userId) {
  const now = Date.now();
  if (!memory[userId]) return;
  memory[userId] = memory[userId].filter(m => now - m.timestamp < MEMORY_LIFESPAN);
}

function pushMemory(userId, role, text) {
  if (!memory[userId]) memory[userId] = [];
  memory[userId].push({ role, text, timestamp: Date.now() });
  const limit = userId.startsWith('U') ? 10 : 5; // 一對一 10 則，群組 5 則
  if (memory[userId].length > limit) memory[userId].shift();
}

app.post('/webhook', async (req, res) => {
  const events = req.body.events;

  for (const event of events) {
    if (event.type === 'message' && event.message.type === 'text') {
      const sourceType = event.source.type;
      const userId = sourceType === 'user' ? event.source.userId : (event.source.groupId || event.source.roomId);
      const userMessage = event.message.text.trim();

      cleanOldMemory(userId);

      if (sourceType === 'user') {
        pushMemory(userId, 'user', userMessage);
        const reply = await askGemini(userId);
        pushMemory(userId, 'model', reply);
        await replyToLine(event.replyToken, reply);
      }

      if (sourceType === 'group' || sourceType === 'room') {
        const mentionedUsers = event.message.mentioned?.mentions || [];
        const mentionedIds = mentionedUsers.map(u => u.userId);

        if (mentionedIds.includes(BOT_USER_ID)) {
          const cleanedMessage = userMessage.replace(/<@[^>]+>/g, '').trim();
          pushMemory(userId, 'user', cleanedMessage);
          const reply = await askGemini(userId);
          pushMemory(userId, 'model', reply);
          await replyToLine(event.replyToken, reply);
        }
      }

      saveMemory();
    }
  }

  res.send('OK');
});

async function askGemini(userId) {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    const history = memory[userId] || [];

    // 整理對話輪流順序
    const chatHistory = [];
    let expectedRole = 'user';
    for (const m of history) {
      if (m.role === expectedRole) {
        chatHistory.push({ role: m.role, parts: [{ text: m.text }] });
        expectedRole = (expectedRole === 'user') ? 'model' : 'user';
      }
    }

    if (chatHistory.length === 0 || chatHistory[chatHistory.length - 1].role !== 'user') {
      throw new Error('No valid user message to send.');
    }

    const chat = model.startChat({ history: chatHistory.slice(0, -1) });
    const result = await chat.sendMessage(chatHistory[chatHistory.length - 1].parts[0].text);
    return result.response.text();
  } catch (error) {
    console.error(error);
    return "抱歉，我現在無法回應。";
  }
}

async function replyToLine(replyToken, message) {
  try {
    await axios.post('https://api.line.me/v2/bot/message/reply', {
      replyToken,
      messages: [{
        type: 'text',
        text: message + ' \uD83D\uDE80' // 加上火箭表情 🚀
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
