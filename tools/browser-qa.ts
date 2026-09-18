// Local-only browser fixtures. Chrome APIs are mocked: no real accounts, mail or proxy changes.
// İşlətmək: tsx tools/browser-qa.ts
import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const mock = `
globalThis.qa = { messages: [], errors: [] };
addEventListener('error', e => qa.errors.push(e.message));
addEventListener('unhandledrejection', e => qa.errors.push(String(e.reason)));
const session = {
  session: { id:'qa', tempId:'temp.tf', relayId:'active-tab', relaySite:'https://example.com', address:'qa@example.com', password:'Test-only-123!', username:'qa_user' },
  inbox: { phase:'empty', address:'qa@example.com', message:'Gözləmə müddəti bitdi', updated:Date.now() }
};
const local = { proxies: { list: Array.from({length:125}, (_,i) => ({ scheme:'http', host:'192.0.2.'+(i+1), port:8080 })) } };
const area = store => ({ get:async key=>({[key]:store[key]}), set:async patch=>Object.assign(store,patch), remove:async key=>delete store[key] });
globalThis.chrome = {
  storage: { session:area(session), local:area(local), onChanged:{addListener(){},removeListener(){}} },
  action:{setBadgeText:async()=>{},setBadgeBackgroundColor:async()=>{},setTitle:async()=>{}},
  runtime:{ sendMessage:async message=>{qa.messages.push(message);return message.type==='proxyConnect' ? {ok:false,error:'Test connection failed'} : {ok:true};} },
  tabs:{ query:async()=>[{id:7,url:'https://example.com/signup'}] },
  permissions:{contains:async()=>true,request:async()=>true},
  proxy:{settings:{get:async()=>({levelOfControl:'controllable_by_this_extension',value:{mode:'system'}})}}
};
`;
const form = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Signup QA fixture</title>
<style>body{font:16px sans-serif;padding:24px}form,section{padding:16px;border:1px solid #aaa;margin:12px}label{display:block;margin:10px}input{padding:8px}</style>
<form id="newsletter"><h2>Newsletter</h2><label>Email <input type="email" id="other-email"></label><label><input type="checkbox" id="other-consent">I agree to marketing</label><button>Subscribe</button></form>
<section role="dialog" aria-label="Create account"><h1>Create account</h1><form id="signup">
<label>Email <input type="email" id="email" autocomplete="email"></label><button type="button" id="send-code">Send code</button>
<label>Password <input type="password" id="password" autocomplete="new-password"></label>
<label><input type="checkbox" id="consent" required>I agree to the Terms of Service</label><button type="submit">Create account</button>
</form></section><script type="module">
import {fillFormInPage} from '/src/background/forms.ts';
globalThis.auditFill = fillFormInPage;
globalThis.qa = {submits:0,codes:0};
document.querySelector('#signup').addEventListener('submit',e=>{e.preventDefault();qa.submits++});
document.querySelector('#send-code').onclick=()=>qa.codes++;
</script></html>`;

// Regression fixture: form DOM is ready immediately, but load/complete remains
// pending for 12 seconds because of an unrelated widget. No account is submitted.
const latencyForm = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Signup latency QA</title>
<style>body{font:16px sans-serif;padding:24px}label{display:block;margin:10px}input{padding:8px}</style>
<div><h1>Get Started For Free</h1><form id="signup" onsubmit="event.preventDefault()">
<label>Email <input type="email" id="email" autocomplete="current-email"></label>
<label>Password <input type="password" id="password" autocomplete="current-password"></label>
<button type="submit">Sign Up With Email</button></form>
<label><input type="checkbox" id="terms">I agree to the Terms of Service and Privacy Policy</label></div>
<script>globalThis.qa={created:Date.now()};
document.addEventListener('input',()=>{if(document.querySelector('#email').value&&document.querySelector('#password').value)qa.filled=Date.now()});
addEventListener('load',()=>qa.loaded=Date.now());</script>
<iframe title="Slow unrelated widget" src="/latency/slow-widget"></iframe></html>`;

// Generic SPA: late header, asynchronously loaded modal, plain div tab, email
// method at the same rank, and a large continuously updating page behind it.
const openerForm = `<!doctype html><html lang="en"><meta charset="utf-8"><title>SPA signup opener QA</title>
<style>body{font:16px sans-serif}header{position:sticky;top:0;background:white}#auth{position:fixed;top:60px;left:30px;padding:24px;background:#eee}label{display:block;margin:12px}input{padding:8px}</style>
<header id="header"></header><div id="auth"></div><section id="prices"></section>
<script>
const params=new URLSearchParams(location.search);
const delay=Number(params.get('modal')||1500);
const header=document.querySelector('#header'),auth=document.querySelector('#auth');
globalThis.qa={start:performance.now(),clicks:[],submits:0};
const record=name=>qa.clicks.push({name,ms:Math.round(performance.now()-qa.start)});
document.querySelector('#prices').innerHTML='<span>Market price </span>'.repeat(6500);
setInterval(()=>{document.querySelector('#prices span').textContent=String(Date.now())},30);
setTimeout(()=>{
  header.innerHTML='<button type="button">Log in</button>';
  header.firstChild.onclick=()=>{record('Log in');setTimeout(()=>{
    auth.innerHTML='<div id="signup-tab">Sign up<div></div></div><p>Choose an account option</p>';
    auth.firstChild.onclick=()=>{record('Sign up');auth.innerHTML='<button type="button">Continue with email</button>';
      auth.firstChild.onclick=()=>{record('Continue with email');auth.innerHTML='<div><form><h1>Create account</h1><label>Email <input type="email" autocomplete="email"></label><label>Password <input type="password" autocomplete="new-password"></label><button type="submit">Create account</button></form><label><input type="checkbox" required>I agree to the Terms of Service</label></div>';qa.ready=Math.round(performance.now()-qa.start);};
    };
  },delay);};
},Number(params.get('header')||80));
document.addEventListener('submit',e=>{e.preventDefault();qa.submits++});
</script></html>`;

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/opener") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(openerForm);
    }
    if (url.pathname.startsWith("/latency")) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      if (url.pathname === "/latency/slow-widget") {
        const timer = setTimeout(() => res.end("<p>Widget ready</p>"), 12000);
        res.on("close", () => clearTimeout(timer));
        return;
      }
      if (url.pathname === "/latency/register") return res.end(latencyForm);
      return res.end('<!doctype html><title>Signup latency start</title><a href="/latency/register">Sign up</a>');
    }
    if (url.pathname === "/form") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(form);
    }
    const requested = url.pathname === "/" ? "/src/popup/popup.html" : url.pathname;
    const file = path.resolve(root, `.${decodeURIComponent(requested)}`);
    if (!file.startsWith(root) || !/\.(html|css|js|png)$/.test(file)) {
      res.writeHead(404); return res.end();
    }
    let content: string | Buffer = await readFile(file);
    if (requested === "/src/popup/popup.html") content = content.toString().replace("<head>", `<head><script>${mock}</script>`);
    res.writeHead(200, { "Content-Type": ({ ".html":"text/html; charset=utf-8", ".css":"text/css", ".js":"text/javascript", ".png":"image/png" })[path.extname(file)] });
    res.end(content);
  } catch { res.writeHead(404); res.end(); }
});
server.listen(0, "127.0.0.1", () => {
  const addr = server.address();
  const port = typeof addr === "object" && addr !== null ? addr.port : 0;
  console.log(`QA fixtures: http://127.0.0.1:${port}/src/popup/popup.html, /form, /latency and /opener`);
});
