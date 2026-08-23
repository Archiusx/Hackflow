// api/delete-file.js
// Vercel serverless function used by the Files (PMS) module.
// Deletes a file's asset from Cloudinary using a signed, server-side
// request so the Cloudinary API secret never reaches the browser.
//
// Uses the same environment variables as api/upload.js:
//   CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET

const crypto = require('crypto');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME || 'sdvziotr';
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  if (!apiKey || !apiSecret) {
    res.status(500).json({ error: 'Cloudinary is not configured on the server (missing CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET environment variable).' });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  body = body || {};

  const publicId = typeof body.publicId === 'string' ? body.publicId : '';
  const resourceType = (typeof body.resourceType === 'string' && body.resourceType) ? body.resourceType : 'raw';

  if (!publicId) {
    res.status(400).json({ error: 'No publicId provided' });
    return;
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const toSign = `public_id=${publicId}&timestamp=${timestamp}`;
  const signature = crypto.createHash('sha1').update(toSign + apiSecret).digest('hex');

  try {
    const form = new URLSearchParams();
    form.append('public_id', publicId);
    form.append('api_key', apiKey);
    form.append('timestamp', String(timestamp));
    form.append('signature', signature);

    const cldRes = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/destroy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form
    });

    const data = await cldRes.json();
    res.status(200).json({ result: (data && data.result) || 'unknown' });
  } catch (e) {
    console.error('Cloudinary delete error:', e);
    res.status(500).json({ error: 'Delete failed: ' + (e && e.message ? e.message : 'unknown error') });
  }
};
