// api/upload.js
// Vercel serverless function used by the Files (PMS) module.
// Uploads a file to Cloudinary using a signed, server-side request so the
// Cloudinary API secret never reaches the browser.
//
// Required environment variables (Vercel -> Project Settings -> Environment
// Variables, then redeploy):
//   CLOUDINARY_CLOUD_NAME = sdvziotr          (defaults to sdvziotr if unset)
//   CLOUDINARY_API_KEY    = <your Cloudinary API key>
//   CLOUDINARY_API_SECRET = <your Cloudinary API secret>   (already set)

const crypto = require('crypto');

// Raise the parsed-body limit above the platform default (~1mb) so a
// base64-encoded PDF (which runs ~33% larger than the original file) still
// fits. Vercel's own hard request-body ceiling (4.5mb) still applies on top
// of this and cannot be raised from function code — that's why the client
// also caps uploads well below it (see MAX_UPLOAD_BYTES in index.html).
module.exports.config = { api: { bodyParser: { sizeLimit: '10mb' } } };

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

  const base64 = typeof body.base64 === 'string' ? body.base64 : '';
  const filename = typeof body.filename === 'string' && body.filename ? body.filename : 'file';
  const folder = (typeof body.folder === 'string' && body.folder) ? body.folder : 'pms';

  if (!base64) {
    res.status(400).json({ error: 'No file data provided' });
    return;
  }

  // Keep the original filename (with extension) inside the public_id so the
  // Cloudinary delivery URL ends with the right extension — this is what
  // lets the browser / viewers open pdf, docx, xlsx, pptx files correctly.
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const publicId = `${folder}/${Date.now()}_${safeName}`;

  // PDFs are signed as resource_type "image" (Cloudinary's own classification
  // for PDFs — it lets Cloudinary render/rasterize them and is what most
  // accounts expect them under); everything else keeps using "auto" so
  // existing docx/pptx/xlsx uploads are untouched.
  const fileExt = (filename.split('.').pop() || '').toLowerCase();
  const isPdf = fileExt === 'pdf';
  const resourceType = isPdf ? 'image' : 'auto';

  const timestamp = Math.floor(Date.now() / 1000);
  const toSign = `public_id=${publicId}&timestamp=${timestamp}`;
  const signature = crypto.createHash('sha1').update(toSign + apiSecret).digest('hex');

  try {
    const mime = isPdf ? 'application/pdf' : 'application/octet-stream';
    const dataUri = base64.startsWith('data:') ? base64 : `data:${mime};base64,${base64}`;
    const form = new URLSearchParams();
    form.append('file', dataUri);
    form.append('api_key', apiKey);
    form.append('timestamp', String(timestamp));
    form.append('public_id', publicId);
    form.append('signature', signature);

    const cldRes = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form
    });

    const rawText = await cldRes.text();
    let data;
    try { data = JSON.parse(rawText); } catch (e) { data = null; }

    if (!cldRes.ok || !data || data.error) {
      const msg = (data && data.error && data.error.message) || rawText.slice(0, 300) || `Cloudinary responded with status ${cldRes.status}`;
      res.status(502).json({ error: msg });
      return;
    }

    res.status(200).json({
      url: data.secure_url,
      publicId: data.public_id,
      resourceType: data.resource_type,
      bytes: data.bytes,
      format: data.format
    });
  } catch (e) {
    console.error('Cloudinary upload error:', e);
    res.status(500).json({ error: 'Upload failed: ' + (e && e.message ? e.message : 'unknown error') });
  }
};
