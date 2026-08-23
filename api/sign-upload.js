// api/sign-upload.js
// Returns a signed Cloudinary upload payload for the BROWSER to upload
// directly to Cloudinary. Only a small JSON request/response passes through
// this server — the actual file bytes go straight from the browser to
// Cloudinary, so Vercel's ~4.5mb serverless request-body ceiling never
// applies and large files (videos, zips, big PDFs, etc.) work.
//
// Required environment variables (same ones api/upload.js already uses):
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

  const filename = typeof body.filename === 'string' && body.filename ? body.filename : 'file';
  const folder = (typeof body.folder === 'string' && body.folder) ? body.folder : 'pms';

  // Keep the original filename (with extension) inside the public_id so the
  // Cloudinary delivery URL ends with the right extension — this is what
  // lets the browser / viewers open any file type correctly.
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const publicId = `${folder}/${Date.now()}_${safeName}`;

  // Cloudinary buckets uploads into resource types: images render/transform,
  // videos stream, and "raw" is the catch-all for everything else (pdf, doc,
  // zip, etc.) so any file type can be stored and fetched back byte-for-byte.
  const ext = (filename.split('.').pop() || '').toLowerCase();
  const imageExts = ['jpg','jpeg','png','gif','webp','bmp','svg','tiff','avif','heic'];
  const videoExts = ['mp4','mov','avi','mkv','webm','m4v','3gp'];
  const resourceType = imageExts.includes(ext) ? 'image' : (videoExts.includes(ext) ? 'video' : 'raw');

  const timestamp = Math.floor(Date.now() / 1000);
  const toSign = `public_id=${publicId}&timestamp=${timestamp}`;
  const signature = crypto.createHash('sha1').update(toSign + apiSecret).digest('hex');

  res.status(200).json({
    cloudName,
    apiKey,
    timestamp,
    publicId,
    signature,
    resourceType,
    uploadUrl: `https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/upload`
  });
};
