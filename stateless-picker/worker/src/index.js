import { Hono } from "hono/tiny";
import { getPageHtml } from "./page.js";
import { getLandingHtml } from "./landing.js";
import { parseCoords, toWgs84, gcj02ToWgs84, round6 } from "./parse.js";
import { ICON_180_B64, ICON_512_B64, ICON_SVG, b64ToBytes } from "./icons.js";
import { LOCATION_SPOOFER_B64, LOCATION_SETTINGS_B64, LOCATION_SPOOFER_QX_B64 } from "./modules.js";
import { SHORTCUT_FILES } from "./shortcuts-data.js";

const app = new Hono();

app.get("/", (c) => {
  c.header("Cache-Control", "no-cache");
  return c.html(getLandingHtml());
});
app.get("/picker", (c) => {
  c.header("Cache-Control", "no-cache");
  return c.html(getPageHtml());
});

/* ---- PWA: manifest + icons (enables "Add to Home Screen") ---- */
const MANIFEST = {
  name: "iOS Location Spoofer",
  short_name: "iOSLoc",
  description: "Stateless map picker for iOS Location Spoofer (WGS-84 + altitude).",
  start_url: "/picker",
  scope: "/",
  display: "standalone",
  orientation: "portrait",
  background_color: "#f2f2f7",
  theme_color: "#007aff",
  icons: [
    { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    { src: "/icon-180.png", sizes: "180x180", type: "image/png", purpose: "any" },
    { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
  ],
};
const IMG_CACHE = "public, max-age=604800, immutable";
app.get("/manifest.webmanifest", (c) =>
  c.body(JSON.stringify(MANIFEST), 200, { "Content-Type": "application/manifest+json", "Cache-Control": IMG_CACHE })
);
app.get("/icon.svg", (c) => c.body(ICON_SVG, 200, { "Content-Type": "image/svg+xml", "Cache-Control": IMG_CACHE }));
app.get("/icon-180.png", (c) => c.body(b64ToBytes(ICON_180_B64), 200, { "Content-Type": "image/png", "Cache-Control": IMG_CACHE }));
app.get("/icon-512.png", (c) => c.body(b64ToBytes(ICON_512_B64), 200, { "Content-Type": "image/png", "Cache-Control": IMG_CACHE }));
app.get("/favicon.ico", (c) => c.body(ICON_SVG, 200, { "Content-Type": "image/svg+xml", "Cache-Control": IMG_CACHE }));

/* ---- Self-hosted on-device module ----
   Serve the two module scripts + a subscribable manifest so the whole stateless
   setup runs from this worker with NO GitHub dependency. The manifest self-references
   whatever domain served it (workers.dev URL or a custom domain). */
const JS_HEADERS = { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "public, max-age=3600" };
app.get("/location-spoofer.js", (c) => c.body(b64ToBytes(LOCATION_SPOOFER_B64), 200, JS_HEADERS));
app.get("/location-settings.js", (c) => c.body(b64ToBytes(LOCATION_SETTINGS_B64), 200, JS_HEADERS));
app.get("/location-spoofer-qx.js", (c) => c.body(b64ToBytes(LOCATION_SPOOFER_QX_B64), 200, JS_HEADERS));

function sgmodule(origin) {
  return String.raw`#!name=iOS Location Spoofer (Stateless)
#!desc=任何售卖本项目/模块的都是骗子，请立即联系退款。无状态版：坐标写入每台设备各自的本机存储、可公开共用、多人互不覆盖。搭配选点页使用。适用于 Shadowrocket / Surge / Egern。
#!homepage=${origin}

[Script]
iOS Location Spoofer = type=http-response,pattern=^https?:\/\/(?:gs-loc(?:-cn)?\.apple\.com|bluedot\.is\.autonavi\.com(?:\.gds\.alibabadns\.com)?)\/clls\/wloc(?:\?.*)?$,requires-body=1,binary-body-mode=1,max-size=1048576,timeout=10,script-path=${origin}/location-spoofer.js,argument=mode=response&debug=false
iLS Settings = type=http-request,pattern=^https?:\/\/gs-loc(?:-cn)?\.apple\.com\/ils-settings\/,requires-body=0,max-size=0,timeout=10,script-path=${origin}/location-settings.js

[MITM]
hostname = %APPEND% gs-loc.apple.com, gs-loc-cn.apple.com, bluedot.is.autonavi.com, bluedot.is.autonavi.com.gds.alibabadns.com`;
}
function stoverride(origin) {
  return String.raw`name: iOS Location Spoofer (Stateless)
desc: "任何售卖本项目/模块的都是骗子，请立即联系退款。iOS Location Spoofer 无状态版 (Stash)"
homepage: ${origin}

http:
  mitm:
    - "gs-loc.apple.com"
    - "gs-loc-cn.apple.com"
  script:
    - match: ^https?:\/\/gs-loc(-cn)?\.apple\.com\/clls\/wloc
      name: ios-location-spoofer
      type: response
      require-body: true
      binary-mode: true
      max-size: 0
      timeout: 30
      argument: mode=response&debug=false
    - match: ^https?:\/\/gs-loc(-cn)?\.apple\.com\/ils-settings\/
      name: ios-location-settings
      type: request
      require-body: false
      timeout: 10

script-providers:
  ios-location-spoofer:
    url: ${origin}/location-spoofer.js
    interval: 86400
  ios-location-settings:
    url: ${origin}/location-settings.js
    interval: 86400`;
}
function lnplugin(origin) {
  return String.raw`#!name=iOS Location Spoofer (Stateless)
#!desc=任何售卖本项目/模块的都是骗子，请立即联系退款。无状态版，配合选点页使用。Loon 插件。
#!homepage=${origin}

[Script]
http-response ^https?:\/\/(?:gs-loc(?:-cn)?\.apple\.com|bluedot\.is\.autonavi\.com(?:\.gds\.alibabadns\.com)?)\/clls\/wloc(?:\?.*)?$ script-path=${origin}/location-spoofer.js, requires-body=true, binary-body-mode=true, max-size=1048576, timeout=12, tag=iOS Location Spoofer, argument=mode=response&debug=false
http-request ^https?:\/\/gs-loc(?:-cn)?\.apple\.com\/ils-settings\/ script-path=${origin}/location-settings.js, requires-body=false, timeout=10, tag=iLS Settings

[MITM]
hostname = gs-loc.apple.com, gs-loc-cn.apple.com, bluedot.is.autonavi.com, bluedot.is.autonavi.com.gds.alibabadns.com`;
}
// Quantumult X has NO module/plugin system — it uses a "rewrite" reference. QX also does
// not auto-merge MITM hostnames the way Surge modules do, so the user must add them manually.
function qxsnippet(origin) {
  return String.raw`#!name=iOS Location Spoofer (Stateless)
#!desc=任何售卖本项目/模块的都是骗子，请立即联系退款。无状态版。Quantumult X 用「重写(rewrite)引用」(非模块/插件)。MITM 主机名需手动加进 QX 设置 → MITM。
#!homepage=${origin}

[rewrite_local]
^https?:\/\/(?:gs-loc(?:-cn)?\.apple\.com|bluedot\.is\.autonavi\.com(?:\.gds\.alibabadns\.com)?)\/clls\/wloc(?:\?.*)?$ url script-response-body ${origin}/location-spoofer-qx.js
^https?:\/\/gs-loc(?:-cn)?\.apple\.com\/ils-settings\/ url script-echo-response ${origin}/location-settings.js

[mitm]
hostname = gs-loc.apple.com, gs-loc-cn.apple.com, bluedot.is.autonavi.com, bluedot.is.autonavi.com.gds.alibabadns.com`;
}
const TXT = { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" };
app.get("/ios-location-spoofer.sgmodule", (c) => c.body(sgmodule(new URL(c.req.url).origin), 200, TXT));
app.get("/ios-location-spoofer.stoverride", (c) => c.body(stoverride(new URL(c.req.url).origin), 200, TXT));
app.get("/ios-location-spoofer.lnplugin", (c) => c.body(lnplugin(new URL(c.req.url).origin), 200, TXT));
app.get("/ios-location-spoofer.snippet", (c) => c.body(qxsnippet(new URL(c.req.url).origin), 200, TXT));

// Map link parsing: called by the iOS Shortcut.
// GET /api/parse?u=<link>&format=json&cs=<gcj|none>
//   Returns {lat, lon, name}; Amap / Apple Maps (both GCJ-02 in mainland China) are auto-converted to WGS84; coordinates outside China are skipped automatically (out_of_china). cs=none forces no conversion.
//   Without format=json it returns a plain-text "lat=..&lon=.." fragment.
app.get("/api/parse", async (c) => {
  const raw = c.req.query("u") || "";
  const cs = (c.req.query("cs") || "").toLowerCase();
  const fmt = (c.req.query("format") || "").toLowerCase();
  try {
    let { lat, lon, name, src } = await parseCoords(raw);
    // Normalize every source to WGS-84 at the entrance (hard requirement).
    // Automatic path uses toWgs84(src): Baidu => BD-09; Amap/Apple/Google => GCJ-02,
    // EXCEPT Apple/Google in HK/Macau/Taiwan which are already WGS-84 (Yu9191 v1.1).
    // Explicit cs= overrides still win. All guards no-op outside China.
    if (cs === "none") {
      // leave coordinates untouched
    } else if (cs === "bd09" || cs === "baidu") {
      ({ lat, lon } = toWgs84(lat, lon, "baidu"));
    } else if (cs === "gcj") {
      ({ lat, lon } = gcj02ToWgs84(lat, lon));
    } else {
      ({ lat, lon } = toWgs84(lat, lon, src));
    }
    lat = round6(lat);
    lon = round6(lon);
    name = name || "";
    c.header("Access-Control-Allow-Origin", "*");
    if (fmt === "json") return c.json({ lat, lon, name });
    return c.text(`lat=${lat}&lon=${lon}`);
  } catch (e) {
    c.header("Access-Control-Allow-Origin", "*");
    return c.json({ error: String(e && e.message ? e.message : e) }, 422);
  }
});

/* ---- iOS 快捷指令一步到位 ----
   GET /api/shortcut?u=<分享来的链接或 "纬度,经度">
        解析 → 转 WGS-84 → 查海拔 → 302 跳到 Apple 的本机写入接口（由模块在设备端拦截落地）。
        快捷指令里只需一个「获取 URL 内容」动作。
   GET /api/shortcut?action=clear   → 302 跳到恢复真实定位的接口。
   加 &fmt=raw 则不跳转，返回纯文本目标 URL，供「两步法」兜底使用。 */
const APPLE_SAVE = "https://gs-loc.apple.com/ils-settings/save";

async function elevationOf(lat, lon) {
  try {
    const r = await fetch(
      `https://api.open-meteo.com/v1/elevation?latitude=${lat}&longitude=${lon}`,
      { signal: AbortSignal.timeout(4000) }
    );
    const j = await r.json();
    const e = j && Array.isArray(j.elevation) ? j.elevation[0] : NaN;
    return Number.isFinite(e) ? Math.round(e) : null;
  } catch (e) {
    return null;
  }
}

app.get("/api/shortcut", async (c) => {
  const fmt = (c.req.query("fmt") || "").toLowerCase();
  const out = (url) =>
    fmt === "raw"
      ? c.body(url, 200, { "Content-Type": "text/plain; charset=utf-8", "Access-Control-Allow-Origin": "*" })
      : c.body(null, 302, { Location: url });
  try {
    if ((c.req.query("action") || "").toLowerCase() === "clear") {
      return out(APPLE_SAVE + "?action=clear");
    }
    let lat, lon, src;
    const u = (c.req.query("u") || "").trim();
    if (u) {
      ({ lat, lon, src } = await parseCoords(u));
      ({ lat, lon } = toWgs84(lat, lon, src));
    } else {
      lat = parseFloat(c.req.query("lat"));
      lon = parseFloat(c.req.query("lon"));
    }
    lat = round6(lat);
    lon = round6(lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      return c.json({ error: "bad coordinates" }, 422);
    }
    let alt = parseFloat(c.req.query("alt"));
    if (!Number.isFinite(alt)) alt = await elevationOf(lat, lon);
    const q = [`lat=${lat}`, `lon=${lon}`];
    if (Number.isFinite(alt)) q.push(`alt=${alt}`);
    q.push("hacc=39", "vacc=1000");
    return out(APPLE_SAVE + "?" + q.join("&"));
  } catch (e) {
    return c.json({ error: String(e && e.message ? e.message : e) }, 422);
  }
});

/* ---- iOS 快捷指令文件下载 ----
   GET /shortcuts/set-location.shortcut  （改定位）
   GET /shortcuts/clear-location.shortcut（恢复真实定位）
   二进制文件由 scripts/gen-shortcuts.mjs 从仓库根目录 shortcuts/ 打进 src/shortcuts-data.js。
   用 Content-Disposition 强制下载 → iPhone 的 Safari 点开就导入「快捷指令」App。
   （GitHub raw 在大陆不可用，所以文件放在自己的域名上。） */
for (const [name, b64] of Object.entries(SHORTCUT_FILES)) {
  app.get(`/shortcuts/${name}`, (c) =>
    c.body(b64ToBytes(b64), 200, {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "public, max-age=86400",
    })
  );
}

/* ---- 一键安装页：点按钮 → 直接跳进「快捷指令」App 导入 ----
   用官方 URL scheme shortcuts://import-shortcut?url=…（Safari 里点一下就跳转，
   不需要先下载文件；对未签名的 .shortcut 也有效，iOS 16~18 均可用）。
   真正的 icloud.com/shortcuts/xxx 分享链接只能在手机上「共享 → 拷贝 iCloud 链接」生成，
   服务器无法代劳 —— 页面里写了生成方法，导入一次后即可拿到。 */
const INSTALL_ITEMS = [
  { file: "set-location.shortcut", btn: "🎯 添加「改定位」", name: "改定位", desc: "分享地图链接 / 坐标文本即可改定位（已在共享表单中显示）" },
  { file: "clear-location.shortcut", btn: "↩️ 添加「恢复定位」", name: "恢复定位", desc: "清除虚拟坐标，恢复真实位置" },
];

function installHtml(origin) {
  const buttons = INSTALL_ITEMS.map((it) => {
    const fileUrl = `${origin}/shortcuts/${it.file}`;
    const deep = `shortcuts://import-shortcut?url=${encodeURIComponent(fileUrl)}&name=${encodeURIComponent(it.name)}`;
    const encoded = deep.replace(/&/g, "&amp;");
    return `<a class="btn" href="${encoded}">${it.btn}</a><p class="desc">${it.desc}</p>`;
  }).join("\n");
  const downloads = INSTALL_ITEMS.map(
    (it) => `<li><a href="/shortcuts/${it.file}">${it.name}.shortcut</a>（Safari 下载后点文件导入）</li>`
  ).join("\n");
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>一键添加到快捷指令 · iOS Location Spoofer</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0 auto; max-width: 640px; padding: 24px 18px 40px; line-height: 1.6; }
  h1 { font-size: 1.5em; margin: 0 0 6px; } h2 { font-size: 1.1em; margin: 28px 0 8px; }
  .tip { background: rgba(0,122,255,.12); border-radius: 12px; padding: 12px 14px; margin: 14px 0 20px; }
  .btn { display: block; text-align: center; text-decoration: none; color: #fff; background: #007aff; border-radius: 14px; padding: 15px 12px; font-size: 1.05em; font-weight: 600; margin: 14px 0 4px; }
  .btn:active { opacity: .7; }
  .desc { margin: 0 4px 18px; font-size: .9em; opacity: .75; }
  details { background: rgba(127,127,127,.12); border-radius: 12px; padding: 12px 14px; }
  summary { cursor: pointer; font-weight: 600; }
  ol, ul { padding-left: 22px; } li { margin: 6px 0; }
  a { color: #007aff; }
  .note { font-size: .85em; opacity: .7; margin-top: 26px; }
  code { word-break: break-all; }
</style></head><body>
<h1>📲 一键添加到快捷指令</h1>
<p class="tip">点下面的按钮，会自动跳到<strong>「快捷指令」App</strong> 并弹出预览，拉到底部点<strong>「添加快捷指令」</strong>即可。<br>
前提：模块已装好（代理 + 开 HTTPS 解密 + 证书已信任）。</p>
${buttons}

<details><summary>点按钮没反应 / 提示打不开？</summary>
<p>按顺序试：</p>
<ol>
  <li><strong>改用下载方式</strong>（Safari 会提示下载，下完在下载列表里点文件即可导入）：
    <ul>${downloads}</ul></li>
  <li>设置 → 快捷指令 → 打开<strong>「允许不受信任的快捷指令」</strong>（首次导入第三方指令会用到）</li>
  <li>都不行就手动搭：改定位 6 步 / 恢复 1 步，见
    <a href="https://github.com/zjun2024/ios-location-spoofer/blob/main/使用教程.md">使用教程</a> 末尾「iOS 快捷指令」章节</li>
</ol>
</details>

<h2>🔗 想要 icloud.com/shortcuts/xxx 那种永久链接？</h2>
<p>那种链接由 <strong>Apple 在你手机上</strong>生成，服务器造不出来。导入上面任意一支后，花 20 秒拿一次即可终身受用：</p>
<ol>
  <li>打开<strong>「快捷指令」App</strong>，在列表里<strong>长按</strong>刚导入的指令</li>
  <li>点<strong>「共享」→「拷贝 iCloud 链接」</strong></li>
  <li>粘贴出来的就是 <code>https://www.icloud.com/shortcuts/…</code>，发给谁都是一点直接跳进快捷指令</li>
</ol>
<p class="note">本页与指令由 ${origin} 提供。</p>
</body></html>`;
}

for (const p of ["/install", "/shortcuts"]) {
  app.get(p, (c) => {
    c.header("Cache-Control", "no-cache");
    return c.html(installHtml(new URL(c.req.url).origin));
  });
}

/* ---- Telegram bot webhook: a user sends /link (or /start) → the bot replies with the homepage link.
   One-time setup:
     1) @BotFather → 你的 bot → 拿 API token
     2) 终端:  wrangler secret put TG_BOT_TOKEN            (粘贴 token)
     3) (可选) wrangler secret put TG_WEBHOOK_SECRET       (任意随机串，防伪造)
     4) 注册回调:  curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=<origin>/tg&secret_token=<SECRET>"
     5) @BotFather → /setprivacy → 选该 bot → Disable      (这样它才能读到群里的 /link)
   Token 只存在 Cloudflare Secret 里，不写进代码。未配置时本路由静默返回 ok，不影响其它功能。 */
app.post("/tg", async (c) => {
  const secret = c.env && c.env.TG_WEBHOOK_SECRET;
  if (secret && c.req.header("X-Telegram-Bot-Api-Secret-Token") !== secret) {
    return c.text("forbidden", 403);
  }
  const token = c.env && c.env.TG_BOT_TOKEN;
  let update = null;
  try { update = await c.req.json(); } catch (e) {}
  const msg = update && (update.message || update.channel_post);
  const text = (msg && msg.text) || "";
  const chatId = msg && msg.chat && msg.chat.id;
  // Match /link, /links, /start — tolerate the /link@BotName form Telegram uses in groups.
  const cmd = text.trim().split(/\s+/)[0].split("@")[0].toLowerCase();
  if (token && chatId && (cmd === "/link" || cmd === "/links" || cmd === "/start")) {
    const origin = new URL(c.req.url).origin;
    const reply =
      "📍 iOS 虚拟定位 · 选点主页\n" + origin + "/\n\n" +
      "⚠️ 免费开源，禁止售卖。若你是付款进来的，请立即联系退款——任何售卖者都是骗子。";
    await fetch("https://api.telegram.org/bot" + token + "/sendMessage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: reply, disable_web_page_preview: false }),
    });
  }
  return c.text("ok", 200);
});

app.onError((e, c) => {
  console.error(`${e}`);
  return c.text(`${e}`, 500);
});

export default {
  async fetch(request, env, ctx) {
    return app.fetch(request, env, ctx);
  },
};
