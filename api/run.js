// api/run.js
// Vercel serverless function used by the Dev Console.
// Proxies code-execution requests to the OneCompiler API so the
// OneCompiler API key never reaches the browser (it stays in the
// server-side "onecompiler_api_key" environment variable you already set).

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.onecompiler_api_key;
  if (!apiKey) {
    return res.status(500).json({ error: 'Server is missing the onecompiler_api_key environment variable.' });
  }

  const { language, files, stdin } = req.body || {};

  if (!language || typeof language !== 'string') {
    return res.status(400).json({ error: 'A "language" is required.' });
  }
  if (!Array.isArray(files) || files.length === 0 || !files[0] || !files[0].name) {
    return res.status(400).json({ error: 'At least one file with a name is required.' });
  }

  try {
    const ocRes = await fetch('https://api.onecompiler.com/v1/run', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey
      },
      body: JSON.stringify({
        language,
        files,
        stdin: typeof stdin === 'string' ? stdin : ''
      })
    });

    const data = await ocRes.json();

    // OneCompiler returns status: "failed" for account/API-level errors
    // (bad key, quota exceeded, unsupported language) — surface that as
    // a clean error message rather than a raw pass-through.
    if (data && data.status === 'failed') {
      return res.status(200).json({ error: data.error || 'Code execution failed.' });
    }

    return res.status(200).json(data);
  } catch (err) {
    console.error('OneCompiler proxy error:', err);
    return res.status(500).json({ error: 'Code execution service is unavailable right now.' });
  }
}
