// index.js 修正記憶存取 + 格式正確版

import express from 'express';
import axios from 'axios';
import { GoogleGenerativeAI } from "@google/generative-ai";
import fs from 'fs';

const app = express();
app.use(express.json());

const CHANNEL_ACCESS_TOKEN = process.env.CHANNEL_ACCESS_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const BOT_USER_ID = process.env.BOT_USER_ID;
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// 簡單記憶體 (最多10條個人/5條群組)
let memory = {};

function saveMemory() {
  try {
    fs.writeFileSync('./memory.json', JSON.stringify(memory));
  } catch (err) {
    console.error('Save memory error:', err);
  }
}

function loadMemory() {
  try {
    if (fs.existsSync('./memory.json')) {
      memory = JSON.parse(fs.readFileSync('./memory.json'));
    }
  } catch (err) {
    console.error('Load memory error:', err);
  }
}

loadMemory();

function addMemory(sourceId, sender, role, text) {
  if (!memory[sourceId]) memory[sourceId] = [];
  memory[sourceId].push({ sender, role, text });
  const limit = sender === 'user' ? 10 : 5;
  if (memory[sourceId].length > limit) {
    memory[sourceId].shift();
  }
  saveMemory();
}

app.post('/webhook', async (req, res) => {
  const events = req.body.events;

  for (const event of events) {
    if (event.type === 'message' && event.message.type === 'text') {
      const userMessage = event.message.text;
      const sourceType = event.source.type;
      const sourceId = sourceType === 'user' ? event.source.userId : event.source.groupId || event.source.roomId;
      const mentioned = event.message.mentioned && event.message.mentioned.mentions && event.message.mentioned.mentions.length > 0;
      const isMentioned = event.message.mentioned?.mentions?.some(m => m.userId === BOT_USER_ID);

      // 加入使用者提問到記憶
      addMemory(sourceId, 'user', 'user', userMessage);

      let shouldReply = false;
      if (sourceType === 'user') {
        shouldReply = true;
      } else if ((sourceType === 'group' || sourceType === 'room') && isMentioned) {
        shouldReply = true;
      }

      if (shouldReply) {
        const reply = await askGemini(sourceId);
        if (sourceType === 'user') {
          await replyToLine(event.replyToken, reply);
        } else {
          await replyToLine(event.replyToken, reply);
        }
        // 加入自己的回答到記憶
        addMemory(sourceId, 'bot', 'model', reply);
      }
    }
  }

  res.send('OK');
});

async function askGemini(sourceId) {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    const chat = model.startChat({
      history: memory[sourceId]?.map(m => ({ role: m.role, parts: [{ text: m.text }] })) || [],
      generationConfig: {
        temperature: 0.7,
      },
    });
    const result = await chat.sendMessage(memory[sourceId]?.slice(-1)[0]?.text || '你好');
    return result.response.text();
  } catch (error) {
    console.error(error);
    return "抱歉，現在無法回答。";
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
    console.error('Reply error:', error);
  }
}

app.listen(8080, () => {
  console.log('Server running on port 8080 🚀');
});
