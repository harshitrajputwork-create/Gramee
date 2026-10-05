/**
 * GramEEE AskGRE Scraper
 *
 * Scrapes all publicly accessible solution offerings from askgre.grameee.org
 * by driving the search UI and intercepting Supabase REST API responses.
 *
 * Usage:
 *   npm install playwright csv-writer
 *   node scrape_askgre_final.js
 *
 * Output:
 *   askgre_offerings.csv   — all offerings as CSV
 *   askgre_raw.json        — raw JSON with metadata
 *
 * Requirements: Node.js 18+, Playwright with Chromium
 */

const { chromium } = require('playwright');
const fs = require('fs');

const BASE_URL = 'https://askgre.grameee.org/';
const FILTERS = {
  category:    ['Knowledge', 'Service', 'Product'],
  domain6m:    ['Manpower', 'Method', 'Machine', 'Material', 'Market', 'Money'],
  offeringType:['Blogs', 'Consulting', 'Financial support', 'Machinery', 'Market reports',
                'Market support', 'Raw material', 'Sop manuals', 'Tech transfer', 'Training', 'Videos'],
  valueChain:  ['Livestock', 'Dairy', 'Poultry', 'Goat', 'Agriculture', 'Bamboo', 'Food Processing'],
  geography:   ['India', 'Karnataka', 'Madhya Pradesh', 'Odisha', 'Maharashtra',
                'Telangana', 'Jharkhand', 'Bihar'],
  language:    ['English', 'Hindi', 'KANNADA', 'MARATHI', 'ODIA', 'TELUGU', 'TAMIL', 'GUJARATI'],
};

const allOfferings = new Map();

function store(item) {
  const key = [item.id, item.name || item.offering_name, item.provider || item.provider_name]
    .filter(Boolean).join('||') || JSON.stringify(item).slice(0, 80);
  if (!allOfferings.has(key)) allOfferings.set(key, item);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();

  // Intercept Supabase REST API responses — this captures structured data directly
  context.on('response', async (resp) => {
    const url = resp.url();
    if (url.includes('supabase.co/rest/v1/') && resp.status() === 200) {
      try {
        const ct = resp.headers()['content-type'] || '';
        if (!ct.includes('json')) return;
        const data = await resp.json();
        if (Array.isArray(data) && data.length > 0) {
          console.log(`  [API] ${data.length} rows from ${url.split('?')[0].split('/').pop()}`);
          data.forEach(store);
        }
      } catch (_) {}
    }
  });

  const page = await context.newPage();
  console.log('Loading AskGRE...');
  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForTimeout(3000);

  // Check that the search UI is loaded
  const hasForm = await page.$('select#category');
  if (!hasForm) {
    console.error('Search form not found — JS may not have hydrated. Try increasing wait time.');
    await browser.close();
    return;
  }
  console.log('Search form ready.\n');

  // Run no-filter search first
  console.log('=== Phase 1: No-filter search ===');
  await clickSearch(page);
  await page.waitForTimeout(3000);
  console.log(`  After default search: ${allOfferings.size} offerings`);

  // Run single-filter sweeps across all filter dimensions
  console.log('\n=== Phase 2: Single-filter sweeps ===');
  for (const [filterName, options] of Object.entries(FILTERS)) {
    for (const option of options) {
      process.stdout.write(`  ${filterName}="${option}"...`);
      await resetFilters(page);
      await page.selectOption(`select#${filterName}`, option);
      await clickSearch(page);
      await page.waitForTimeout(1500);
      console.log(` total: ${allOfferings.size}`);
    }
  }

  // Cross-filter: valueChain × category
  console.log('\n=== Phase 3: Cross-filter sweeps (valueChain × category) ===');
  for (const vc of FILTERS.valueChain) {
    for (const cat of FILTERS.category) {
      await resetFilters(page);
      await page.selectOption('select#valueChain', vc);
      await page.selectOption('select#category', cat);
      await clickSearch(page);
      await page.waitForTimeout(1200);
    }
  }

  // Geography × domain6m sweeps
  console.log('\n=== Phase 4: Geography × 6M domain ===');
  for (const geo of FILTERS.geography) {
    for (const dom of FILTERS.domain6m) {
      await resetFilters(page);
      await page.selectOption('select#geography', geo);
      await page.selectOption('select#domain6m', dom);
      await clickSearch(page);
      await page.waitForTimeout(1000);
    }
  }

  console.log(`\n=== COMPLETE: ${allOfferings.size} unique offerings collected ===`);
  await browser.close();

  // ---- If API intercept worked, we have rich data ----
  const offerings = Array.from(allOfferings.values());

  if (offerings.length === 0) {
    console.log('\nAPI intercept yielded 0 rows.');
    console.log('This may mean Supabase RLS policies require authentication.');
    console.log('Next step: request the dataset directly from Grameen Consortium.');
    return;
  }

  // Save JSON
  fs.writeFileSync('askgre_raw.json', JSON.stringify({
    scraped_at: new Date().toISOString(),
    source: BASE_URL,
    total: offerings.length,
    note: 'Scraped from public search UI — private sector solution provider data, not government schemes',
    fields: Object.keys(offerings[0]),
    offerings,
  }, null, 2));
  console.log('Saved: askgre_raw.json');

  // Save CSV
  const headers = [...new Set(offerings.flatMap(o => Object.keys(o)))];
  const csvRows = [
    headers.map(h => `"${h}"`).join(','),
    ...offerings.map(o =>
      headers.map(h => `"${String(o[h] ?? '').replace(/"/g, '""')}"`).join(',')
    ),
  ];
  fs.writeFileSync('askgre_offerings.csv', csvRows.join('\n'), 'utf8');
  console.log(`Saved: askgre_offerings.csv (${offerings.length} rows, ${headers.length} columns)`);
  console.log('Columns:', headers.join(', '));
}

async function clickSearch(page) {
  try {
    await page.click('button:has-text("Run parameter search")', { timeout: 5000 });
  } catch (_) {
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')]
        .find(b => /run.*search/i.test(b.textContent));
      if (btn) btn.click();
    });
  }
}

async function resetFilters(page) {
  try {
    await page.click('button:has-text("Reset all")', { timeout: 3000 });
    await page.waitForTimeout(200);
  } catch (_) {
    const selects = await page.$$('select');
    for (const s of selects) await s.selectOption({ index: 0 }).catch(() => {});
  }
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
