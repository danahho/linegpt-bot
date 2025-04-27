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
if (fs.existsSync(memoryFile)) {
  memory = JSON.parse(fs.readFileSync(memoryFile));
}

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

      // 群組必須標記機器人才回應
      if (sourceType === 'group' || sourceType === 'room') {
        const mentions = event.message.mentioned?.mentions || [];
        const mentionedIds = mentions.map(u => u.userId);
        if (!mentionedIds.includes(BOT_USER_ID)) {
          continue;
        }
        userMessage = userMessage.replace(/@[^\s]+/g, '').trim();
      }

      memory[userId].push({ role: 'user', text: userMessage });

      if (memory[userId].length > (sourceType === 'user' ? 10 : 5)) {
        memory[userId].shift();
      }

      const reply = await askGemini(userId);
      memory[userId].push({ role: 'model', text: reply });
      await replyToLine(event.replyToken, reply);
      saveMemory();
    }
  }

  res.send('OK');
});

async function askGemini(userId) {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    const history = memory[userId] || [];

    const chatHistory = [];
    let expect = 'user';

    for (const item of history) {
      if (item.role === expect) {
        chatHistory.push({ role: item.role, parts: [{ text: item.text }] });
        expect = expect === 'user' ? 'model' : 'user';
      }
    }

    const chat = model.startChat({ history: chatHistory });
    const lastUserMessage = history.filter(m => m.role === 'user').slice(-1)[0]?.text || '';
    const result = await chat.sendMessage(lastUserMessage);
    return result.response.text();
  } catch (error) {
    console.error(error);
    return '抱歉，現在無法回應。';
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
