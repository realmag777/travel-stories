// Lighthouse (mobile preset) for the home page, /stories and a story page.
// Usage: APP_URL=http://localhost:8350 node tools/lighthouse.js
const fs = require('fs');
const path = require('path');

const APP = (process.env.APP_URL || 'http://localhost:8350').replace(/\/$/, '');
const PAGES = [['home', '/'], ['stories', '/stories'], ['story', '/stories/68498236a100312bea07901c']];

(async () => {
  const { default: lighthouse } = await import('lighthouse');
  const chromeLauncher = await import('chrome-launcher');
  const chrome = await chromeLauncher.launch({ chromeFlags: ['--headless=new', '--no-sandbox', '--disable-gpu'] });
  const out = {};
  try {
    for (const [name, p] of PAGES) {
      const r = await lighthouse(APP + p, {
        port: chrome.port, output: 'json', logLevel: 'error',
        onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
        formFactor: 'mobile', screenEmulation: { mobile: true, width: 412, height: 823, deviceScaleFactor: 1.75, disabled: false },
        throttlingMethod: 'simulate',
      });
      const c = r.lhr.categories;
      const a = r.lhr.audits;
      out[name] = {
        performance: Math.round(c.performance.score * 100),
        accessibility: Math.round(c.accessibility.score * 100),
        bestPractices: Math.round(c['best-practices'].score * 100),
        seo: Math.round(c.seo.score * 100),
        lcp: a['largest-contentful-paint'].displayValue,
        cls: a['cumulative-layout-shift'].displayValue,
        tbt: a['total-blocking-time'].displayValue,
        fcp: a['first-contentful-paint'].displayValue,
        failed: Object.values(a).filter((x) => x.score !== null && x.score < 0.9 && x.scoreDisplayMode === 'binary').map((x) => x.id).slice(0, 12),
      };
      console.log(`${name.padEnd(8)} perf ${out[name].performance}  a11y ${out[name].accessibility}  bp ${out[name].bestPractices}  seo ${out[name].seo}  LCP ${out[name].lcp}  CLS ${out[name].cls}  TBT ${out[name].tbt}`);
      if (out[name].failed.length) console.log('         failed:', out[name].failed.join(', '));
    }
  } finally {
    await chrome.kill();
  }
  fs.mkdirSync(path.join(__dirname, '..', 'docs'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, '..', 'docs', 'lighthouse.json'), JSON.stringify({ at: new Date().toISOString(), url: APP, pages: out }, null, 1));
})();
