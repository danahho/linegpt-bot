const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

const CHANNEL_ACCESS_TOKEN = process.env.CHANNEL_ACCESS_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

app.post('/webhook', async (req, res) => {
  const events = req.body.events;
  for (const event of events) {
    if (event.type === 'message' && event.message.type === 'text') {
      const userMessage = event.message.text;
      const reply = await askGemini(userMessage);
      await replyToLine(event.replyToken, reply);
    }
  }
  res.send('OK');
});

async function askGemini(message) {
  try {
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${GEMINI_API_KEY}`,
      {
        contents: [
          {
            parts: [{ text: message }]
          }
        ]
      }
    );
    return response.data.candidates[0].content.parts[0].text.trim();
  } catch (error) {
    console.error(error.response?.data || error.message);
    return '抱歉，我無法回應。';
  }
}

async function replyToLine(replyToken, message) {
  try {
    await axios.post('https://api.line.me/v2/bot/message/reply', {
      replyToken: replyToken,
      messages: [{ type: 'text', text: message }]
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
