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
      const userMessage = event.message.text.trim();

      if (!memory[userId]) memory[userId] = [];
      memory[userId].push({ role: 'user', content: userMessage });

      if (memory[userId].length > (sourceType === 'user' ? 10 : 5)) {
        memory[userId].shift();
      }

      if (sourceType === 'user') {
        const reply = await askGemini(memory[userId]);
        memory[userId].push({ role: 'assistant', content: reply });
        await replyToLine(event.replyToken, reply);
        saveMemory();
      }

      if (sourceType === 'group' || sourceType === 'room') {
        const mentionedUsers = event.message.mentioned?.mentions || [];
        const mentionedIds = mentionedUsers.map(u => u.userId);
        const botMentioned = mentionedIds.includes(BOT_USER_ID) || event.message.text.includes('@阿和智慧助理V1');

        if (botMentioned) {
          const cleanedMessage = event.message.text.replace(/<@[^>]+>/g, '').replace('@阿和智慧助理V1', '').trim();
          memory[userId].push({ role: 'user', content: cleanedMessage });
          const reply = await askGemini(memory[userId]);
          memory[userId].push({ role: 'assistant', content: reply });
          await replyToLine(event.replyToken, reply);
          saveMemory();
        }
      }
    }
  }
  res.send('OK');
});

async function askGemini(history) {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

    // 整理符合 Gemini 格式的聊天歷史
    const chatHistory = [];
    let expectRole = "user";

    for (const item of history) {
      if (item.role === expectRole) {
        chatHistory.push({ role: item.role, parts: [{ text: item.content }] });
        expectRole = (expectRole === "user") ? "model" : "user";
      }
    }

    // 取得最後一句訊息
    const lastMessage = history[history.length - 1]?.content || '';
    if (!lastMessage.trim()) {
      return "我沒有收到任何可以回應的內容喔～";
    }

    const chat = model.startChat({ history: chatHistory });
    const result = await chat.sendMessage(lastMessage);
    const text = result.response.text();

    return text;

  } catch (error) {
    console.error("❗ Gemini 錯誤：", error.message || error);

    if (typeof error.message === 'string') {
      if (error.message.includes("503")) {
        return "現在伺服器有點忙，請稍後再試～🤖💤";
      }
      if (error.message.includes("429")) {
        return "請求太頻繁了，等我一下再問吧！⏳";
      }
      if (error.message.includes("403")) {
        return "授權出問題，請確認 API 金鑰是否正確 ✅";
      }
    }

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
