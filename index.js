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

const memoryFile = path.resolve('memory.json');
let memory = fs.existsSync(memoryFile) ? JSON.parse(fs.readFileSync(memoryFile)) : {};

function saveMemory() {
  fs.writeFileSync(memoryFile, JSON.stringify(memory));
}

app.post('/webhook', async (req, res) => {
  const events = req.body.events;

  for (const event of events) {
    if (event.type === 'message' && event.message.type === 'text') {
      const sourceType = event.source.type;
      const userId = sourceType === 'user' ? event.source.userId : (event.source.groupId || event.source.roomId);
      let userMessage = event.message.text.trim();

      if (!memory[userId]) memory[userId] = [];

      // 群組標記檢查
      if (sourceType === 'group' || sourceType === 'room') {
        const mentionedUsers = event.message.mentioned?.mentions || [];
        const mentionedIds = mentionedUsers.map(u => u.userId);

        if (!mentionedIds.includes(BOT_USER_ID)) {
          continue; // 沒有標記到Bot，不回應
        }
        userMessage = userMessage.replace(/@[^\s]+/g, '').trim();
      }

      memory[userId].push({ role: 'user', content: userMessage });

      // 限制記憶數量
      const maxMemory = sourceType === 'user' ? 10 : 5;
      if (memory[userId].length > maxMemory * 2) { // *2 因為一問一答
        memory[userId] = memory[userId].slice(-maxMemory * 2);
      }

      const reply = await askGemini(memory[userId]);
      memory[userId].push({ role: 'assistant', content: reply });
      saveMemory();

      await replyToLine(event.replyToken, reply);
    }
  }

  res.send('OK');
});

async function askGemini(context) {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

    const chatHistory = [];
    let expectRole = 'user';

    for (const msg of context) {
      if (msg.role === expectRole) {
        chatHistory.push({ role: msg.role, parts: [{ text: msg.content }] });
        expectRole = (expectRole === 'user') ? 'model' : 'user';
      }
    }

    const chat = model.startChat({ history: chatHistory });
    const latestUserMessage = context.filter(c => c.role === 'user').slice(-1)[0].content;
    const result = await chat.sendMessage(latestUserMessage);
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
      messages: [{ type: 'text', text: message }]
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
