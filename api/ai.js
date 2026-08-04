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

// Node types the flowchart canvas actually knows how to draw — kept in
// sync with FLOW_SHAPES / FLOW_ARCH_ICONS in index.html. The 'flowchart'
// action is instructed to only ever use one of these as a node "type".
const FLOW_VALID_TYPES = [
  'start','end','process','input','output','decision',
  'user','browser','mobile','api','apiGateway','auth','authz','database','cache','storage',
  'fileStorage','queue','messageBroker','event','server','microservice','container','kubernetes',
  'loadBalancer','reverseProxy','firewall','network','internet','cdn','dns','email','notification',
  'payment','search','analytics','monitoring','logging','configuration','settings','secret',
  'encryption','certificate','scheduler','aiLlm','vectorDb','externalService','thirdPartyApi',
  'cicd','git','docker','cloud','backup','error','success','warning'
];

const FLOWCHART_SYSTEM_PROMPT = `You design flowcharts and system-architecture diagrams for a diagramming app.
Given a description of an app, workflow, or system, output ONLY a single JSON object (no markdown fences, no commentary) with this exact shape:
{"nodes":[{"key":"n1","type":"start","label":"Short label","row":0,"col":0}, ...],"edges":[{"from":"n1","to":"n2"}, ...]}

Rules:
- "type" must be one of exactly these values: ${FLOW_VALID_TYPES.join(', ')}.
- Use "start" for the entry point and "end" for terminal points when it's a workflow/flowchart; for a system architecture diagram, use the relevant component types (user, browser, apiGateway, server, database, etc.) instead.
- "key" is a short unique string you invent, referenced by "from"/"to" in edges.
- "label" is short (2-5 words), plain text, no markdown.
- "row" and "col" are small non-negative integers describing a grid position (top-to-bottom = increasing row, left-to-right = increasing col) that lays the diagram out logically with no overlapping nodes at the same row+col.
- Keep it focused: typically 4-14 nodes unless the description clearly calls for more.
- Every node except isolated ones should be connected by at least one edge.
- Output must be valid JSON and nothing else.`;

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // Accept a couple of common env-var name variants so a case/underscore
  // mismatch in the Vercel dashboard doesn't silently break this.
  const apiKey = process.env.GROQ_API_KEY || process.env.Groq_api_key || process.env.GROQ_APIKEY;
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

  const isFlowchart = action === 'flowchart';
  const basePrompt = ACTION_PROMPTS[action];
  if (!isFlowchart && !basePrompt) {
    res.status(400).json({ error: 'Unknown action: ' + action });
    return;
  }
  if (!text.trim() && action !== 'write') {
    res.status(400).json({ error: 'No text provided' });
    return;
  }

  let messages;
  if (isFlowchart) {
    let userContent = 'Description:\n' + text;
    if (instruction.trim()) userContent += '\n\nExtra instructions: ' + instruction.trim();
    messages = [
      { role: 'system', content: FLOWCHART_SYSTEM_PROMPT },
      { role: 'user', content: userContent }
    ];
  } else {
    const userParts = [basePrompt];
    if (instruction.trim()) userParts.push('Extra instructions: ' + instruction.trim());
    userParts.push(action === 'write' ? ('Topic/notes:\n' + (text || instruction || '')) : ('Text:\n' + text));
    messages = [
      { role: 'system', content: 'You are a precise writing assistant embedded in a productivity app. Follow the instruction exactly and respond with plain text only — no markdown fences, no explanations, no preamble.' },
      { role: 'user', content: userParts.join('\n\n') }
    ];
  }

  try {
    const groqPayload = {
      model: GROQ_MODEL,
      messages,
      temperature: isFlowchart ? 0.3 : 0.5,
      max_tokens: isFlowchart ? 2048 : 1024
    };
    if (isFlowchart) groqPayload.response_format = { type: 'json_object' };

    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey
      },
      body: JSON.stringify(groqPayload)
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
