import express from 'express';
import axios from 'axios';
import { GoogleGenerativeAI } from "@google/generative-ai";

const app = express();
app.use(express.json());

const CHANNEL_ACCESS_TOKEN = process.env.CHANNEL_ACCESS_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

app.post('/webhook', async (req, res) => {
  const events = req.body.events;

  for (const event of events) {
    if (event.type === 'message' && event.message.type === 'text') {
      const userMessage = event.message.text;
      const sourceType = event.source.type;
      const userId = event.source.userId;

      if (sourceType === 'user') {
        await replyToLine(event.replyToken, "思考中，請稍等喔...");
        const reply = await askGemini(userMessage);
        await pushMessage(userId, reply);
      }

      if (sourceType === 'group' || sourceType === 'room') {
        const mentioned = event.message.mentioned && event.message.mentioned.mentions && event.message.mentioned.mentions.length > 0;
        if (mentioned) {
          await replyToLine(event.replyToken, "思考中，請稍等喔...");
          const reply = await askGemini(userMessage);
          await pushMessage(userId, reply);
        }
      }
    }
  }

  res.send('OK');
});

async function askGemini(message) {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro-latest" });
    const result = await model.generateContent(message);
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
    console.error(error);
  }
}

app.listen(8080, () => {
  console.log('Server running on port 8080');
});
