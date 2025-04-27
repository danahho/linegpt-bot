// index.js 修正版
import express from 'express';
import axios from 'axios';
import { GoogleGenerativeAI } from "@google/generative-ai";
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json());

const CHANNEL_ACCESS_TOKEN = process.env.CHANNEL_ACCESS_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const BOT_USER_ID = process.env.BOT_USER_ID;
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

const MEMORY_FILE = './memory.json';
const memory = fs.existsSync(MEMORY_FILE) ? JSON.parse(fs.readFileSync(MEMORY_FILE)) : {};

function saveMemory() {
  fs.writeFileSync(MEMORY_FILE, JSON.stringify(memory));
}

app.post('/webhook', async (req, res) => {
  const events = req.body.events;

  for (const event of events) {
    if (event.type === 'message' && (event.message.type === 'text' || event.message.type === 'image')) {
      const userMessage = event.message.text || '[圖片訊息]';
      const sourceType = event.source.type;
      const sourceId = sourceType === 'user' ? event.source.userId : event.source.groupId || event.source.roomId;

      // 初始化記憶
      if (!memory[sourceId]) memory[sourceId] = [];

      // 記錄用戶說的話
      memory[sourceId].push({ role: 'user', parts: [{ text: userMessage }] });

      // 保持記憶量（群組最多5則，個人最多10則）
      const maxMemory = sourceType === 'user' ? 10 : 5;
      if (memory[sourceId].length > maxMemory * 2) {
        memory[sourceId] = memory[sourceId].slice(-maxMemory * 2);
      }

      saveMemory();

      let mentioned = false;
      if (sourceType === 'group' || sourceType === 'room') {
        mentioned = event.message.mentioned && event.message.mentioned.mentions.some(m => m.userId === BOT_USER_ID);
      }

      if (sourceType === 'user' || mentioned) {
        const reply = await askGemini(memory[sourceId]);
        memory[sourceId].push({ role: 'model', parts: [{ text: reply }] });
        saveMemory();

        if (sourceType === 'user') {
          await replyToLine(event.replyToken, reply);
        } else if (sourceType === 'group' || sourceType === 'room') {
          await replyToLine(event.replyToken, reply);
        }
      }
    }
  }

  res.send('OK');
});

async function askGemini(history) {
  try {
    const messages = cleanHistory(history);
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    const chat = await model.startChat({ history: messages });
    const result = await chat.sendMessage(messages[messages.length - 1].parts[0].text);
    const response = await result.response;
    return response.text();
  } catch (error) {
    console.error(error);
    return "抱歉，目前無法回答，請稍後再試。";
  }
}

function cleanHistory(hist) {
  const fixed = [];
  for (let i = 0; i < hist.length; i++) {
    fixed.push(hist[i]);
    if (hist[i].role === 'user' && (i + 1 === hist.length || hist[i + 1].role === 'user')) {
      fixed.push({ role: 'model', parts: [{ text: '...' }] });
    }
  }
  return fixed;
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
