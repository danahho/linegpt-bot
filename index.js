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

// 輕量記憶體
const memory = {};  // RAM 記憶體

app.post('/webhook', async (req, res) => {
  const events = req.body.events;

  for (const event of events) {
    if (event.type === 'message' && event.message.type === 'text') {
      const sourceType = event.source.type;
      const userId = sourceType === 'user' ? event.source.userId : (event.source.groupId || event.source.roomId);
      const userMessage = event.message.text.trim();

      if (!memory[userId]) memory[userId] = [];

      // 把使用者的訊息記錄起來
      memory[userId].push({ role: 'user', text: userMessage });
      if (memory[userId].length > (sourceType === 'user' ? 10 : 5)) memory[userId].shift();

      let shouldRespond = false;

      if (sourceType === 'user') {
        shouldRespond = true;
      } else if (sourceType === 'group' || sourceType === 'room') {
        if (userMessage.includes(BOT_USER_ID) || userMessage.includes('@阿和智慧助理V1')) {
          shouldRespond = true;
        }
      }

      if (shouldRespond) {
        await replyToLine(event.replyToken, '思考中... 🤔');
        const reply = await askGemini(memory[userId]);
        memory[userId].push({ role: 'model', text: reply });
        await pushMessage(userId, reply);
      }
    }
  }

  res.send('OK');
});

async function askGemini(history) {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

    const chatHistory = [];
    let expectRole = 'user';

    for (const item of history) {
      if (item.role === expectRole) {
        chatHistory.push({ role: item.role, parts: [{ text: item.text }] });
        expectRole = expectRole === 'user' ? 'model' : 'user';
      }
    }

    const chat = model.startChat({ history: chatHistory });
    const lastUserInput = history.filter(h => h.role === 'user').slice(-1)[0]?.text || '你好';
    const result = await chat.sendMessage(lastUserInput);
    const text = result.response.text();

    return text;
  } catch (error) {
    console.error(error);
    return "抱歉，我現在無法回應。🥺";
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
    console.error('Reply error:', error);
  }
}

async function pushMessage(to, message) {
  try {
    await axios.post('https://api.line.me/v2/bot/message/push', {
      to,
      messages: [{ type: 'text', text: message }]
    }, {
      headers: {
        'Authorization': `Bearer ${CHANNEL_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Push error:', error);
  }
}

app.listen(8080, () => {
  console.log('Server running on port 8080 🚀');
});
