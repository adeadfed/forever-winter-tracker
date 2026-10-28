import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const dist = path.join(root, "dist");
const read = (name) => fs.readFileSync(path.join(dist, name), "utf8");

const css = read("styles.css");
const data = read("data.js");
const app = read("app.js");
let html = read("index.html");

html = html
  .replace(/\s*<link rel="preconnect"[^>]*>/g, "")
  .replace(/\s*<link href="https:\/\/fonts\.googleapis\.com[^>]*>/g, "")
  .replace(/\s*<link rel="stylesheet" href="styles\.css">/, `\n  <style>\n${css}\n  </style>`)
  .replace(/\s*<script src="data\.js"><\/script>/, `\n  <script>\n${data}\n  </script>`)
  .replace(/\s*<script src="app\.js"><\/script>/, `\n  <script>\n${app}\n  </script>`);

fs.writeFileSync(path.join(dist, "standalone.html"), html);
console.log(`Built dist/standalone.html (${Buffer.byteLength(html).toLocaleString()} bytes).`);
