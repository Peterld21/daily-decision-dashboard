/**
 * 通用工具：fetchJSON、缓存策略、DOM 助手、信号映射。
 *
 * 缓存策略（对齐 Big Picture）：
 *   - manifest.json: 每次新鲜拉取（强制 ?v=now）
 *   - reports/<date>/index.json: 强制 ?v=now（数据每日更新）
 *   - reports/<date>/charts/<TICKER>.json: 同上
 *
 * 备注：所有数据均同源静态文件，浏览器**绝不**请求外部 API。
 */

export const DATA_VERSION = Date.now();

/** 给 URL 加上 ?v=<时间戳> 用于绕过 CDN/浏览器旧缓存。 */
export function withVersion(url) {
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}v=${DATA_VERSION}`;
}

/** 同源 JSON 读取。失败返回 null（调用方决定降级）。 */
export async function fetchJSON(url, { busted = true } = {}) {
  const finalUrl = busted ? withVersion(url) : url;
  try {
    const res = await fetch(finalUrl, { credentials: 'omit' });
    if (!res.ok) {
      console.warn(`[fetchJSON] ${finalUrl} -> HTTP ${res.status}`);
      return null;
    }
    return await res.json();
  } catch (e) {
    console.warn(`[fetchJSON] ${finalUrl}`, e);
    return null;
  }
}

/** ticker → DOM id 安全片段（与 Python _slug 对齐）。 */
export function slug(ticker) {
  return String(ticker || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** emoji → 卡片 / 行 信号类名。 */
export function signalClass(emoji) {
  switch (emoji) {
    case '🟢': return 'signal-buy';
    case '🟡': return 'signal-hold';
    case '⚪': return 'signal-watch';
    case '🔴': return 'signal-sell';
    case '🟠': return 'signal-sell';
    default:   return 'signal-watch';
  }
}

/** 浮点数四舍五入到 N 位，null 保持。 */
export function round(v, digits = 1) {
  if (v == null || Number.isNaN(v)) return null;
  const k = Math.pow(10, digits);
  return Math.round(v * k) / k;
}

/** 简易元素构造器。 */
export function h(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2).toLowerCase(), v);
    } else {
      el.setAttribute(k, String(v));
    }
  }
  for (const c of [].concat(children)) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(c));
  }
  return el;
}

/** marked.js 包装：缺失时退回原文。 */
export function renderMarkdown(md) {
  if (!md) return '';
  if (typeof window !== 'undefined' && window.marked && typeof window.marked.parse === 'function') {
    return window.marked.parse(md, { gfm: true, breaks: true });
  }
  return md;
}
