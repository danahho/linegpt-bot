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

// 輕量記憶，最多保留10則
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
      const userMessage = event.message.text.trim();

      if (!memory[userId]) memory[userId] = [];
      memory[userId].push({ role: 'user', content: userMessage });

      if (memory[userId].length > (sourceType === 'user' ? 10 : 5)) {
        memory[userId].shift();
      }

      // 一對一私訊
      if (sourceType === 'user') {
        const reply = await askGemini(memory[userId]);
        memory[userId].push({ role: 'assistant', content: reply });
        await replyToLine(event.replyToken, reply);
      }

      // 群組或聊天室標記
      if (sourceType === 'group' || sourceType === 'room') {
        const mentionedUsers = event.message.mentioned?.mentions || [];
        const mentionedIds = mentionedUsers.map(u => u.userId);

        if (mentionedIds.includes(BOT_USER_ID)) {
          const cleanedMessage = userMessage.replace(/<@[^>]+>/g, '').trim();
          memory[userId].push({ role: 'user', content: cleanedMessage });
          const reply = await askGemini(memory[userId]);
          memory[userId].push({ role: 'assistant', content: reply });
          await replyToLine(event.replyToken, reply);
        }
      }
      saveMemory();
    }
  }

  res.send('OK');
});

async function askGemini(history) {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    const chat = model.startChat({ history: history.map(msg => ({ role: msg.role, parts: [{ text: msg.content }] })) });
    const result = await chat.sendMessage(history[history.length - 1].content);
    const response = await result.response;
    const text = response.text();
    return text;
  } catch (error) {
    console.error(error);
    return "抱歉，我現在無法回應喔！";
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
