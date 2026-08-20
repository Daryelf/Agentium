// ─────────────────────────────────────────────────────────────────────────────
// Image Generation Service
// Uses OpenAI DALL-E 3 to generate product images for 3D printed items
// ─────────────────────────────────────────────────────────────────────────────

let openaiClient;

function getOpenAI() {
  if (!openaiClient) {
    if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not set');
    const { OpenAI } = require('openai');
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openaiClient;
}

/**
 * Generate a product image using DALL-E 3
 * @param {object} params
 * @param {string} params.productName
 * @param {string} params.productType
 * @param {string} [params.color='white']
 * @param {string} [params.style='product photography']
 * @returns {string} image URL (temporary — download and store if you want to keep it)
 */
async function generateProductImage({ productName, productType, color = 'white', style = 'product photography' }) {
  const openai = getOpenAI();

  const prompt = `Professional ${style} of a 3D printed ${productType || 'object'} called "${productName}".
Color: ${color}. Clean white background. Studio lighting. High detail.
The item looks freshly printed with visible layer texture. No hands, no people.`;

  const response = await openai.images.generate({
    model: 'dall-e-3',
    prompt,
    n: 1,
    size: '1024x1024',
    quality: 'standard'
  });

  return response.data[0].url;
}

/**
 * Generate a social media image (square, more dramatic)
 * @param {object} params
 * @param {string} params.productName
 * @param {string} [params.background='dark gradient']
 * @returns {string} image URL
 */
async function generateSocialImage({ productName, background = 'dark gradient' }) {
  const openai = getOpenAI();

  const prompt = `Eye-catching social media product photo of a 3D printed "${productName}".
${background} background. Dramatic studio lighting with rim light.
Photorealistic render style. Perfect for Instagram/TikTok. Square format.`;

  const response = await openai.images.generate({
    model: 'dall-e-3',
    prompt,
    n: 1,
    size: '1024x1024',
    quality: 'hd'
  });

  return response.data[0].url;
}

module.exports = { generateProductImage, generateSocialImage };
