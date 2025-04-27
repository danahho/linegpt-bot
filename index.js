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
let memory = {};

// 讀取記憶並清除過期﻿
function loadMemory() {
  if (fs.existsSync(memoryFile)) {
    memory = JSON.parse(fs.readFileSync(memoryFile));
    const now = Date.now();
    const expireDuration = 24 * 60 * 60 * 1000;

    for (const userId in memory) {
      if (memory[userId].timestamp && now - memory[userId].timestamp > expireDuration) {
        delete memory[userId];
      }
    }
  }
}

// 存檔
function saveMemory() {
  fs.writeFileSync(memoryFile, JSON.stringify(memory));
}

// 更新記憶
function updateMemory(userId, newMemoryArray) {
  memory[userId] = {
    data: newMemoryArray,
    timestamp: Date.now(),
  };
  saveMemory();
}

// 啟動時先讀記憶
loadMemory();

app.post('/webhook', async (req, res) => {
  const events = req.body.events;

  for (const event of events) {
    if (event.type === 'message' && event.message.type === 'text') {
      const sourceType = event.source.type;
      const userId = sourceType === 'user' ? event.source.userId : (event.source.groupId || event.source.roomId);
      const userMessage = event.message.text.trim();

      let currentMemory = memory[userId]?.data || [];
      
      // 對話內容
      if (sourceType === 'user') {
        currentMemory.push({ role: 'user', content: userMessage });
        if (currentMemory.length > 10) currentMemory.shift();

        const reply = await askGemini(currentMemory);
        currentMemory.push({ role: 'assistant', content: reply });

        await replyToLine(event.replyToken, reply);
        updateMemory(userId, currentMemory);
      }

      if (sourceType === 'group' || sourceType === 'room') {
        const mentionedUsers = event.message.mentioned?.mentions || [];
        const mentionedIds = mentionedUsers.map(u => u.userId);

        if (mentionedIds.includes(BOT_USER_ID)) {
          const cleanedMessage = userMessage.replace(/<@[^>]+>/g, '').trim();
          currentMemory.push({ role: 'user', content: cleanedMessage });
          if (currentMemory.length > 5) currentMemory.shift();

          const reply = await askGemini(currentMemory);
          currentMemory.push({ role: 'assistant', content: reply });

          await replyToLine(event.replyToken, reply);
          updateMemory(userId, currentMemory);
        }
      }
    }
  }

  res.send('OK');
});

async function askGemini(history) {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

    const chatHistory = [];
    let expectRole = "user";

    for (const item of history) {
      if (item.role === expectRole) {
        chatHistory.push({ role: item.role, parts: [{ text: item.content }] });
        expectRole = expectRole === "user" ? "model" : "user";
      }
    }

    const lastUserMessage = history.filter(m => m.role === 'user').slice(-1)[0]?.content || "";
    chatHistory.push({ role: 'user', parts: [{ text: lastUserMessage }] });

    const chat = model.startChat({ history: chatHistory });
    const result = await chat.sendMessage(lastUserMessage);
    const text = result.response.text();

    return text + ' 🚀'; // 加上emoji
  } catch (error) {
    console.error(error);
    return "抱歉，我現在無法回應。🤖";
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
