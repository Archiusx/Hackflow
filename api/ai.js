// /api/ai.js
// Serverless function (Vercel) that proxies text-AI requests to Groq.
// Called by the client as: POST /api/ai  { action, text, instruction }
// Keeps GROQ_API_KEY server-side only — never exposed to the browser.
//
// Set the environment variable in Vercel:
//   GROQ_API_KEY = <your Groq API key>
// (Project Settings -> Environment Variables, then redeploy.)

// Groq deprecated llama-3.3-70b-versatile on 2026-06-17 — using their
// recommended replacement (see https://console.groq.com/docs/deprecations).
const GROQ_MODEL = 'openai/gpt-oss-120b';

const ACTION_PROMPTS = {
  summarize: 'Summarize the following text clearly and concisely, keeping the key points. Return only the summary, no preamble.',
  write: 'Write fresh content based on the following topic/notes/instruction. Return only the written content, no preamble.',
  edit: 'Edit and correct the following text for grammar, clarity and flow, keeping the original meaning and tone. Return only the edited text, no preamble.',
  shorten: 'Make the following text shorter and more concise while keeping its meaning. Return only the shortened text, no preamble.',
  describe: 'Write a clear, descriptive expansion of the following text/topic. Return only the description, no preamble.',
  enhance: 'Enhance and polish the following text to make it more engaging and professional, keeping its original meaning. Return only the enhanced text, no preamble.'
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'GROQ_API_KEY is not configured on the server' });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  body = body || {};

  const action = typeof body.action === 'string' ? body.action : '';
  const text = typeof body.text === 'string' ? body.text : '';
  const instruction = typeof body.instruction === 'string' ? body.instruction : '';

  const basePrompt = ACTION_PROMPTS[action];
  if (!basePrompt) {
    res.status(400).json({ error: 'Unknown action: ' + action });
    return;
  }
  if (!text.trim() && action !== 'write') {
    res.status(400).json({ error: 'No text provided' });
    return;
  }

  const userParts = [basePrompt];
  if (instruction.trim()) userParts.push('Extra instructions: ' + instruction.trim());
  userParts.push(action === 'write' ? ('Topic/notes:\n' + (text || instruction || '')) : ('Text:\n' + text));
  const userContent = userParts.join('\n\n');

  try {
    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          { role: 'system', content: 'You are a precise writing assistant embedded in a productivity app. Follow the instruction exactly and respond with plain text only — no markdown fences, no explanations, no preamble.' },
          { role: 'user', content: userContent }
        ],
        temperature: 0.5,
        max_tokens: 1024
      })
    });

    if (!groqRes.ok) {
      const errText = await groqRes.text().catch(() => '');
      res.status(502).json({ error: 'Groq API error: ' + groqRes.status + ' ' + errText.slice(0, 300) });
      return;
    }

    const data = await groqRes.json();
    const result = data && data.choices && data.choices[0] && data.choices[0].message
      ? (data.choices[0].message.content || '').trim()
      : '';

    if (!result) {
      res.status(502).json({ error: 'Empty response from AI' });
      return;
    }

    res.status(200).json({ result });
  } catch (e) {
    res.status(500).json({ error: 'AI request failed: ' + (e && e.message ? e.message : 'unknown error') });
  }
};
