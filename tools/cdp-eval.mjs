// Drives the page in headless Chrome (CDP) and prints what the steps return: for behaviour checks and for screenshots
// of states that need clicks (the stock cdp-shots.js only scrolls). Not a screenshot harness of its own: it evaluates
// the steps of a script file and, where a step is followed by `//--- shot: name`, saves a PNG.
//   node tools/cdp-eval.mjs <url> <outdir> <w> <h> <steps.js> [port] [dark|light] [reduce]
// steps.js: chunks separated by lines `//--- shot: name` (or `//--- wait: ms`); each chunk is an async JS body run in the
// page (top-level await, `return` a value to print it). Console errors are listed at the end.
import { spawn } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [url, outdir, W, H, stepsFile, PORT = '9400', scheme = 'light', reduce = ''] = process.argv.slice(2);
const port = Number(PORT);
const chrome = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const prof = join(tmpdir(), `cdp-eval-${port}`);
mkdirSync(outdir, { recursive: true });
const proc = spawn(chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, `--window-size=${W},${H}`,
  '--autoplay-policy=no-user-gesture-required', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const logs = [];
let ws;
for (let i = 0; i < 50 && !ws; i++) { try { const j = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); ws = j.find((t) => t.type === 'page')?.webSocketDebuggerUrl; } catch { /* retry */ } await sleep(200); }
const sock = new WebSocket(ws);
await new Promise((r) => { sock.onopen = r; });
let id = 0;
const pend = {};
const waiters = [];
sock.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pend[m.id]) { pend[m.id](m); delete pend[m.id]; return; }
  if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) logs.push(`[console.${m.params.type}] ${m.params.args.map((a) => a.value ?? a.description ?? a.type).join(' ')}`);
  if (m.method === 'Runtime.exceptionThrown') logs.push(`[exception] ${m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text}`);
  waiters.forEach((w) => w(m));
};
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend[i] = r; sock.send(JSON.stringify({ id: i, method, params })); });
const run = async (body) => {
  const r = await send('Runtime.evaluate', { expression: `(async () => { ${body}\n})()`, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) return `ERROR ${r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text}`;
  return r.result?.result?.value;
};
await send('Runtime.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: +W, height: +H, deviceScaleFactor: 1, mobile: +W < 700 });
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }, ...(reduce ? [{ name: 'prefers-reduced-motion', value: 'reduce' }] : [])] });
const loaded = new Promise((r) => waiters.push((m) => { if (m.method === 'Page.loadEventFired') r(); }));
await send('Page.navigate', { url });
await loaded;
await sleep(2500);
const chunks = readFileSync(stepsFile, 'utf8').split(/^\/\/--- /m);
for (const [k, c] of chunks.entries()) {
  const nl = c.indexOf('\n');
  const head = k === 0 ? '' : c.slice(0, nl).trim();
  const body = k === 0 ? c : c.slice(nl + 1);
  if (head.startsWith('wait:')) { await sleep(Number(head.slice(5))); }
  if (body.trim()) { const v = await run(body); if (v !== undefined) console.log('=>', typeof v === 'string' ? v : JSON.stringify(v)); }
  if (head.startsWith('shot:')) {
    await sleep(400);
    const name = head.slice(5).trim();
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(outdir, `${name}.png`), Buffer.from(shot.result.data, 'base64'));
    console.log('SHOT', name);
  }
}
console.log('LOGS', JSON.stringify(logs));
sock.close(); proc.kill(); await sleep(400);
try { rmSync(prof, { recursive: true, force: true }); } catch { /* ignore */ }
process.exit(0);
