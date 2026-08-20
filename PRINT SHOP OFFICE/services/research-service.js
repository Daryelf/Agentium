// ─────────────────────────────────────────────────────────────────────────────
// Research Service — OpenAI-powered market intelligence for Agent 202
// Uses GPT-4o with web_search_preview tool to find REAL trending products,
// pricing data, competition info, and sourcing options.
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

let openaiClient;

function getOpenAI() {
  if (!openaiClient) {
    if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not set');
    const { OpenAI } = require('openai');
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openaiClient;
}

const RESEARCH_MODEL = 'gpt-4o';

/**
 * Research trending 3D printable products right now.
 * Uses GPT-4o with browsing to look at Etsy, Amazon, TikTok trends.
 *
 * @param {object} params
 * @param {string} [params.niche] - optional niche focus (e.g. "desk accessories", "gaming", "home decor")
 * @param {number} [params.count=10] - how many product ideas to return
 * @returns {object} { ideas: [...], sources: [...], generated_at: "..." }
 */
async function researchTrendingProducts({ niche, count = 10 } = {}) {
  const openai = getOpenAI();

  const nicheClause = niche ? `Focus specifically on the "${niche}" niche.` : 'Cover a range of niches.';

  const prompt = `You are a 3D print product researcher. Your job is to find real, proven, currently trending 3D printed products that sell well.

Search across Etsy, Amazon Handmade, TikTok Shop, and popular 3D print communities (Printables, Thingiverse, Makerworld) to identify what is selling RIGHT NOW in ${new Date().getFullYear()}.

${nicheClause}

For each product idea, provide:
1. Product name and description (2–3 sentences)
2. Why it sells (market demand signal)
3. Estimated Etsy/Amazon selling price range (USD)
4. Estimated material cost (filament grams, hours to print)
5. Competition level: low / medium / high
6. Suggested social platform to market it (TikTok, Instagram, etc.)
7. Where to find the STL file or design (Printables, Thingiverse, custom design needed, etc.)

Return exactly ${count} product ideas, ranked from best opportunity to worst.
Format as valid JSON: { "ideas": [ { "rank": 1, "name": "", "description": "", "why_it_sells": "", "price_range": "$X–$Y", "filament_grams": 0, "print_hours": 0, "competition": "low|medium|high", "platform": "", "design_source": "", "notes": "" }, ... ] }`;

  const response = await openai.responses.create({
    model: RESEARCH_MODEL,
    tools: [{ type: 'web_search_preview' }],
    input: prompt
  });

  // Extract the output text
  const outputText = response.output
    .filter(block => block.type === 'message')
    .flatMap(m => m.content)
    .filter(c => c.type === 'output_text')
    .map(c => c.text)
    .join('');

  // Parse JSON from the response
  const jsonMatch = outputText.match(/\{[\s\S]*\}/);
  let ideas = [];
  if (jsonMatch) {
    try { ideas = JSON.parse(jsonMatch[0]).ideas || []; } catch {}
  }

  // Fallback: return raw if parse failed
  return {
    ideas,
    raw: ideas.length === 0 ? outputText : undefined,
    niche: niche || 'general',
    generated_at: new Date().toISOString()
  };
}

/**
 * Deep-dive analysis of a specific product opportunity.
 * Researches real competitors, pricing, demand signals, and marketing angles.
 *
 * @param {object} params
 * @param {string} params.productName
 * @param {string} [params.productDescription]
 * @returns {object} full market analysis
 */
async function analyzeProductOpportunity({ productName, productDescription = '' }) {
  const openai = getOpenAI();

  const prompt = `You are a 3D print business analyst. Do a thorough market analysis for this 3D printed product:

Product: "${productName}"
${productDescription ? `Description: ${productDescription}` : ''}

Search Etsy, Amazon, TikTok, and print communities to answer:

1. **Market Demand**: How many sellers are on Etsy? What are the bestseller badge holders selling? Monthly search volume signals?
2. **Price Benchmarks**: Real price examples from actual listings (low / average / premium tier)
3. **Top Competitors**: Name 2–3 real sellers/shops doing this well and why they win
4. **Differentiation Opportunities**: What gap exists? What would make our version stand out?
5. **Marketing Angle**: Best TikTok/Instagram hook. What kind of content performs for this product?
6. **Design Sources**: Best STL sources (Printables, Thingiverse, MakerWorld) or if custom design is needed
7. **Material Recommendation**: Best filament type, color, finish for this product
8. **Risk Factors**: IP/copyright issues? Seasonal demand? Saturation?
9. **Verdict**: Go / Caution / Skip — with 1-sentence reason

Return as JSON:
{
  "product": "${productName}",
  "demand": { "signal": "high|medium|low", "details": "" },
  "price_benchmarks": { "low": "$X", "average": "$Y", "premium": "$Z" },
  "competitors": [{ "name": "", "url": "", "why_they_win": "" }],
  "differentiation": "",
  "marketing_angle": { "platform": "", "hook": "", "content_type": "" },
  "design_sources": [{ "name": "", "url": "", "notes": "" }],
  "material_recommendation": { "type": "", "color": "", "finish": "" },
  "risks": [""],
  "verdict": "go|caution|skip",
  "verdict_reason": "",
  "analyzed_at": "${new Date().toISOString()}"
}`;

  const response = await openai.responses.create({
    model: RESEARCH_MODEL,
    tools: [{ type: 'web_search_preview' }],
    input: prompt
  });

  const outputText = response.output
    .filter(b => b.type === 'message')
    .flatMap(m => m.content)
    .filter(c => c.type === 'output_text')
    .map(c => c.text)
    .join('');

  const jsonMatch = outputText.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try { return JSON.parse(jsonMatch[0]); } catch {}
  }
  return { product: productName, raw: outputText, analyzed_at: new Date().toISOString() };
}

/**
 * Find real STL/design sources for a product.
 * Searches Printables, Thingiverse, MakerWorld, Cults3D.
 *
 * @param {object} params
 * @param {string} params.productName
 * @param {string} [params.style] - e.g. "minimalist", "detailed", "functional"
 * @returns {object} list of design sources
 */
async function findDesignSources({ productName, style = '' }) {
  const openai = getOpenAI();

  const prompt = `Search Printables.com, Thingiverse.com, MakerWorld.com, and Cults3D.com for printable 3D designs for: "${productName}"
${style ? `Style preference: ${style}` : ''}

Find the best available designs and return:
- Design name and brief description
- Platform (Printables / Thingiverse / MakerWorld / Cults3D)
- Direct URL
- License type (free / paid / commercial-ok)
- Quality rating if available
- Whether it's suitable for commercial selling

Return JSON:
{
  "product": "${productName}",
  "designs": [
    {
      "name": "",
      "platform": "",
      "url": "",
      "description": "",
      "license": "free|paid|commercial-ok|non-commercial",
      "quality": "high|medium|unknown",
      "commercial_ok": true,
      "notes": ""
    }
  ],
  "recommendation": "Which design to use and why",
  "custom_design_needed": false,
  "searched_at": "${new Date().toISOString()}"
}`;

  const response = await openai.responses.create({
    model: RESEARCH_MODEL,
    tools: [{ type: 'web_search_preview' }],
    input: prompt
  });

  const outputText = response.output
    .filter(b => b.type === 'message')
    .flatMap(m => m.content)
    .filter(c => c.type === 'output_text')
    .map(c => c.text)
    .join('');

  const jsonMatch = outputText.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try { return JSON.parse(jsonMatch[0]); } catch {}
  }
  return { product: productName, raw: outputText, searched_at: new Date().toISOString() };
}

/**
 * Generate a ready-to-publish product spec from research data.
 * Takes raw research and produces a complete product record.
 *
 * @param {object} params
 * @param {string} params.productName
 * @param {object} [params.researchData] - analysis data from analyzeProductOpportunity
 * @returns {object} complete product spec ready for create_product
 */
async function generateProductSpec({ productName, researchData = {} }) {
  const openai = getOpenAI();

  const prompt = `Based on this market research, generate a complete, optimized product listing for a 3D print shop.

Product: "${productName}"
Research data: ${JSON.stringify(researchData, null, 2)}

Generate:
1. SEO-optimized product name (for Etsy/online search)
2. Compelling product description (3 paragraphs — hook, details, CTA)
3. Recommended price in USD (based on research benchmarks, aim for mid-premium tier)
4. Estimated filament grams and print hours
5. 5 keywords/tags for SEO
6. TikTok/Instagram caption for launch post

Return JSON:
{
  "name": "",
  "description": "",
  "price_usd": 0.00,
  "price_cents": 0,
  "filament_grams": 0,
  "print_hours": 0,
  "keywords": ["", "", "", "", ""],
  "social_caption": "",
  "material_type": "PLA|PETG|Resin",
  "material_color": ""
}`;

  const response = await openai.chat.completions.create({
    model: RESEARCH_MODEL,
    response_format: { type: 'json_object' },
    messages: [{ role: 'user', content: prompt }]
  });

  try {
    return JSON.parse(response.choices[0].message.content);
  } catch {
    return { name: productName, raw: response.choices[0].message.content };
  }
}

module.exports = {
  researchTrendingProducts,
  analyzeProductOpportunity,
  findDesignSources,
  generateProductSpec
};
