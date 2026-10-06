// Drives a real browser (Edge or Chrome, headless) through the live site: sign in, open every page, ask a question, log out.
// Usage:  SITE=https://your-site.onrender.com SITE_PASSWORD=... pnpm check:site [--no-chat]
// Why a real browser: command-line tools do not send what browsers send (for example Origin: null on form posts).
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SITE = process.env.SITE?.replace(/\/+$/, "");
const PASSWORD = process.env.SITE_PASSWORD;
const WITH_CHAT = !process.argv.includes("--no-chat");
if (!SITE || !PASSWORD) {
  console.error("Set SITE and SITE_PASSWORD, for example:\n  SITE=https://your-site.onrender.com SITE_PASSWORD=your-password pnpm check:site");
  process.exit(2);
}
const BROWSER = [process.env.BROWSER_PATH, "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Google/Chrome/Application/chrome.exe", "/usr/bin/google-chrome", "/usr/bin/chromium"].find((p) => p && existsSync(p));
if (!BROWSER) {
  console.error("No Edge or Chrome found. Set BROWSER_PATH to the browser program.");
  process.exit(2);
}
const PORT = 9335;
const edge = spawn(BROWSER, ["--headless=new", "--disable-gpu", `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "kairo-check-"))}`, "--remote-allow-origins=*", "--no-first-run", "--window-size=1300,900", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let target;
for (let i = 0; i < 40 && !target; i++) {
  try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === "page"); } catch {}
  if (!target) await sleep(500);
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
const events = [];
ws.onmessage = (m) => {
  const x = JSON.parse(m.data);
  if (x.id && pending.has(x.id)) pending.get(x.id)(x);
  else if (x.method) events.push(x);
};
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJs = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result.result.value;
const waitLoad = async (ms = 120000) => {
  const from = events.length, start = Date.now();
  while (Date.now() - start < ms) { if (events.slice(from).some((e) => e.method === "Page.loadEventFired")) return true; await sleep(250); }
  return false;
};
const text = async () => (await evalJs("document.body ? document.body.innerText : ''")) ?? "";
const where = () => evalJs("location.href");

await send("Page.enable");
await send("Network.enable");
const log = (s) => console.log(s);
const seen = new Set();
const failures = () => {
  const out = [];
  for (const e of events) if (e.method === "Network.responseReceived" && e.params.response.status >= 400 && !seen.has(e.params.requestId) && !e.params.response.url.endsWith("favicon.ico")) { seen.add(e.params.requestId); out.push(`${e.params.response.status} ${e.params.response.url.replace(SITE, "")}`); }
  return out;
};
let problems = 0;
const check = (ok, label) => { log(`   ${ok ? "PASS" : "FAIL"}  ${label}`); if (!ok) problems++; };

log(`site: ${SITE}`);
log("1) visiting the site without signing in");
await send("Page.navigate", { url: SITE });
await waitLoad();
check((await where()).includes("/login"), `redirected to the login page (${(await where()).replace(SITE, "")})`);
const loginText = await text();
check(!/Task History|Work Tree|Ask AI|Log out|AI Audit/.test(loginText), "the login page shows no menu and no data to someone who is not signed in");

log("2) typing the password into the login form and pressing the button");
await evalJs(`(() => { const i = document.querySelector('input[name=password]'); i.value = ${JSON.stringify(PASSWORD)}; i.form.requestSubmit(); })()`);
await waitLoad();
await sleep(1200);
const home = await text();
check(!/forbidden/i.test(home) && (await where()).replace(SITE, "") === "/", `signed in and landed on the home page (${(await where()).replace(SITE, "") || "/"})`);
check(/Keep what your team knows/.test(home), "welcome page content is visible");


log("4) every page opens");
for (const path of ["/history", "/tree", "/ask", "/settings", "/audit", "/history/SHOP-2"]) {
  await send("Page.navigate", { url: SITE + path });
  await waitLoad();
  await sleep(1000);
  const t = await text();
  check(t.length > 200 && !/forbidden|Something went wrong/i.test(t), `${path} shows its content`);
}

if (WITH_CHAT) {
log("5) asking a question in Ask AI, like a visitor would");
await send("Page.navigate", { url: SITE + "/ask" });
await waitLoad();
await sleep(1000);
await evalJs(`(() => { const ta = document.querySelector('textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, 'Why did we choose Elasticsearch instead of Algolia?'); ta.dispatchEvent(new Event('input', { bubbles: true })); })()`);
await sleep(300);
await evalJs(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Ask').click()`);
let chat = "";
for (let i = 0; i < 90; i++) {
  await sleep(1000);
  chat = await text();
  if (/Sources|closest ticket|forbidden|AI service failed|Too many|read-only/i.test(chat)) break;
}
check(!/forbidden/i.test(chat) && /Sources|closest ticket/i.test(chat), `an answer with sources appeared, no 'forbidden' (${JSON.stringify(chat.replace(/\s+/g, " ").slice(-130))})`);

}

log("6) logging out");
await evalJs(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Log out').click()`);
await waitLoad();
await sleep(800);
check((await where()).includes("/login"), `back at the login page (${(await where()).replace(SITE, "")})`);
await send("Page.navigate", { url: SITE + "/history" });
await waitLoad();
check((await where()).includes("/login"), "pages are locked again after logging out");

log("7) a wrong password");
await evalJs(`(() => { const i = document.querySelector('input[name=password]'); i.value = 'definitely-wrong'; i.form.requestSubmit(); })()`);
await waitLoad();
await sleep(800);
const bad = await text();
check(/not correct/i.test(bad) && !/forbidden/i.test(bad), `friendly message shown (${JSON.stringify(bad.replace(/\s+/g, " ").slice(-60))})`);

const f = failures();
log(`\nfailed requests (excluding the sign-out redirects): ${f.length ? f.join(" | ") : "none"}`);
log(problems === 0 ? "\nALL CHECKS PASSED" : `\n${problems} CHECK(S) FAILED`);
ws.close();
edge.kill();
process.exit(problems ? 1 : 0);
