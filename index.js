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

// 軟軟的記憶，最多10則
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

      if (sourceType === 'user') {
        const reply = await askGemini(userId, userMessage);
        await replyToLine(event.replyToken, reply);
      }

      if (sourceType === 'group' || sourceType === 'room') {
        const mentionedUsers = event.message.mentioned?.mentions || [];
        const mentionedIds = mentionedUsers.map(u => u.userId);

        if (mentionedIds.includes(BOT_USER_ID)) {
          userMessage = userMessage.replace(/<@[^>]+>/g, '').trim();
          const reply = await askGemini(userId, userMessage);
          await replyToLine(event.replyToken, reply);
        }
      }
    }
  }
  res.send('OK');
});

async function askGemini(userId, userMessage) {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

    const history = memory[userId] || [];
    const chatHistory = [];
    let expectRole = "user";

    for (const item of history) {
      if (item.role === expectRole) {
        chatHistory.push({ role: item.role, parts: [{ text: item.content }] });
        expectRole = (expectRole === "user") ? "model" : "user";
      }
    }

    chatHistory.push({ role: "user", parts: [{ text: userMessage }] });

    const chat = model.startChat({ history: chatHistory });
    const result = await chat.sendMessage(userMessage);
    const text = result.response.text();

    if (!memory[userId]) memory[userId] = [];

    memory[userId].push({ role: "user", content: userMessage });
    memory[userId].push({ role: "assistant", content: text });

    if (memory[userId].length > (userId.startsWith('U') ? 10 : 5)) {
      memory[userId].shift();
      memory[userId].shift(); // 一個問答一起刪
    }

    saveMemory();

    return text;
  } catch (error) {
    console.error(error);
    return "🚗 抱歉，我現在無法回應，等我接下一班！";
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
