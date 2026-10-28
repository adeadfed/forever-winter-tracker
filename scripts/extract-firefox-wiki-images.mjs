import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const cacheRoot = path.join(os.homedir(), "Library", "Caches", "Firefox", "Profiles");
const outputRoot = path.resolve(import.meta.dirname, "..", "dist", "assets", "wiki");
const listOnly = process.argv.includes("--list");
const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const iend = Buffer.from("IEND", "ascii");
const jpgSignature = Buffer.from([0xff, 0xd8, 0xff]);
const jpgEnd = Buffer.from([0xff, 0xd9]);
const riffSignature = Buffer.from("RIFF", "ascii");
const webpSignature = Buffer.from("WEBP", "ascii");

function extractUrl(text) {
  const candidates = text.match(/https:\/\/[^\0\r\n ]+/g) ?? [];
  return candidates.find((url) => /theforeverwinter|wiki\.gg|wikitide/i.test(url) && /\.(png|jpe?g)(?:\?|$)/i.test(url))
    ?? candidates.find((url) => /theforeverwinter|wiki\.gg|wikitide/i.test(url))
    ?? "";
}

function safeName(url, fallback) {
  try {
    const clean = decodeURIComponent(new URL(url).pathname.split("/").pop() || fallback);
    return clean.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "") || fallback;
  } catch {
    return fallback;
  }
}

function imagePayload(buffer) {
  const webpStart = buffer.indexOf(riffSignature);
  if (webpStart >= 0 && buffer.subarray(webpStart + 8, webpStart + 12).equals(webpSignature)) {
    const size = buffer.readUInt32LE(webpStart + 4) + 8;
    if (size > 12 && webpStart + size <= buffer.length) return { bytes: buffer.subarray(webpStart, webpStart + size), ext: ".webp" };
  }
  const pngStart = buffer.indexOf(pngSignature);
  if (pngStart >= 0) {
    const marker = buffer.indexOf(iend, pngStart);
    if (marker >= 0) return { bytes: buffer.subarray(pngStart, marker + 8), ext: ".png" };
  }
  const jpgStart = buffer.indexOf(jpgSignature);
  if (jpgStart >= 0) {
    const marker = buffer.indexOf(jpgEnd, jpgStart + 3);
    if (marker >= 0) return { bytes: buffer.subarray(jpgStart, marker + 2), ext: ".jpg" };
  }
  return null;
}

const found = [];
for (const profile of fs.readdirSync(cacheRoot)) {
  const entries = path.join(cacheRoot, profile, "cache2", "entries");
  if (!fs.existsSync(entries)) continue;
  for (const entry of fs.readdirSync(entries)) {
    const source = path.join(entries, entry);
    let buffer;
    try { buffer = fs.readFileSync(source); }
    catch (error) { if (error.code === "ENOENT") continue; throw error; }
    const text = buffer.toString("latin1");
    if (!/theforeverwinter|wiki\.gg|wikitide/i.test(text)) continue;
    const payload = imagePayload(buffer);
    if (!payload) continue;
    const url = extractUrl(text);
    const base = safeName(url, entry + payload.ext);
    const name = /\.(png|jpe?g)$/i.test(base) ? base : base + payload.ext;
    found.push({ source, url, name, bytes: payload.bytes });
  }
}

const unique = new Map();
for (const item of found) {
  const key = item.url || item.name;
  if (!unique.has(key) || unique.get(key).bytes.length < item.bytes.length) unique.set(key, item);
}

if (!listOnly) fs.mkdirSync(outputRoot, { recursive: true });
const written = [];
for (const item of unique.values()) {
  if (!listOnly) {
    const destination = path.join(outputRoot, item.name);
    if (item.bytes.subarray(0, 4).equals(riffSignature) && /\.png$/i.test(item.name)) {
      const temporary = destination + ".webp.part";
      fs.writeFileSync(temporary, item.bytes);
      try { execFileSync("sips", ["-s", "format", "png", temporary, "--out", destination], { stdio: "ignore" }); }
      finally { try { fs.unlinkSync(temporary); } catch {} }
    } else fs.writeFileSync(destination, item.bytes);
    written.push({ ...item, destination });
  }
  console.log(`${item.bytes.length}\t${item.name}\t${item.url}`);
}

if (!listOnly) {
  const portraitRoot = path.resolve(outputRoot, "..", "portraits");
  const aliases = [
    [/DrMorrow/i, "doctor-morrow.png"],
    [/Vladelets_Euruska_Quest_Giver/i, "vladelets.png"],
  ];
  fs.mkdirSync(portraitRoot, { recursive: true });
  for (const [pattern, alias] of aliases) {
    const source = written.find((item) => pattern.test(decodeURIComponent(item.url)) && /\.png$/i.test(item.destination));
    if (source) fs.copyFileSync(source.destination, path.join(portraitRoot, alias));
  }
}
console.error(`${listOnly ? "Found" : "Extracted"} ${unique.size} cached wiki images.`);
