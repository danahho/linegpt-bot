// ✨ 輕量版 記憶功能的 index.js

import express from 'express';
import axios from 'axios';
import fs from 'fs';
import { GoogleGenerativeAI } from "@google/generative-ai";

const app = express();
app.use(express.json());

const CHANNEL_ACCESS_TOKEN = process.env.CHANNEL_ACCESS_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const BOT_NAME = '@阿和智慧助理V1';
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

const lastMessages = {}; // 記憶空間
const MAX_MEMORY = 5; // 每人/每群最多記5則

app.post('/webhook', async (req, res) => {
  const events = req.body.events;

  for (const event of events) {
    const sourceType = event.source.type;
    const userId = event.source.userId;
    const groupId = event.source.groupId;
    const sourceId = (sourceType === 'group' || sourceType === 'room') ? groupId : userId;

    if (event.type === 'message') {
      // 收到任何訊息就記錄
      if (!lastMessages[sourceId]) {
        lastMessages[sourceId] = [];
      }
      lastMessages[sourceId].push(event.message);
      if (lastMessages[sourceId].length > MAX_MEMORY) {
        lastMessages[sourceId].shift(); // 超過上限，移除最舊的
      }
    }

    if (event.type === 'message' && event.message.type === 'text') {
      const userMessage = event.message.text;
      const isMentionedByText = userMessage.includes(BOT_NAME);

      const replyTarget = (sourceType === 'group' || sourceType === 'room') ? groupId : userId;

      if (sourceType === 'user') {
        await replyToLine(event.replyToken, "思考中，請稍等喔...");
        const reply = await buildReplyPrompt(sourceId, userMessage);
        await pushMessage(replyTarget, reply);
      }

      if ((sourceType === 'group' || sourceType === 'room') && isMentionedByText) {
        const cleanedText = userMessage.replace(BOT_NAME, '').trim();

        if (cleanedText !== '') {
          await replyToLine(event.replyToken, "思考中，請稍等喔...");
          const reply = await buildReplyPrompt(sourceId, cleanedText);
          await pushMessage(replyTarget, reply);
        }
      }
    }
  }

  res.send('OK');
});

async function buildReplyPrompt(sourceId, newQuestion) {
  let memory = lastMessages[sourceId] || [];
  let context = '';

  memory.forEach((msg, index) => {
    if (msg.type === 'text') {
      context += `第${index + 1}則文字：「${msg.text}」。\n`;
    } else if (msg.type === 'image') {
      context += `第${index + 1}則收到一張圖片。\n`;
    }
  });

  const finalPrompt = `${context}使用者提問：「${newQuestion}」`;

  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    const result = await model.generateContent(finalPrompt);
    const response = await result.response;
    return response.text();
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

async function pushMessage(to, message) {
  try {
    await axios.post('https://api.line.me/v2/bot/message/push', {
      to,
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
    console.error(error.response?.data || error.message);
  }
}

app.listen(8080, () => {
  console.log('Server running on port 8080');
});
