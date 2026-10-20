// Markdown with maths for AI answers. Output is sanitised with DOMPurify; maths is
// rendered by KaTeX (which escapes its input) after sanitising.

import { marked } from "../vendor/marked.esm.js";
import DOMPurify from "../vendor/purify.es.mjs";
import katex from "../vendor/katex/katex.mjs";

marked.setOptions({ gfm: true, breaks: true });

DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A") {
    const href = node.getAttribute("href") || "";
    if (/^https?:/i.test(href)) {
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer");
    }
  }
});

const MATH = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|\$([^\s$](?:[^$\n]*?[^\s$])?)\$/g;

function renderMath(tex, display) {
  try {
    return katex.renderToString(tex, { displayMode: display, throwOnError: false, output: "html", trust: false, strict: "ignore" });
  } catch {
    return null;
  }
}

/** Returns sanitised HTML with maths rendered. */
export function markdownToHtml(text) {
  const maths = [];
  const protectedText = String(text || "").replace(MATH, (match, d1, d2, i1, i2) => {
    const display = d1 !== undefined || d2 !== undefined;
    const tex = d1 ?? d2 ?? i1 ?? i2;
    maths.push({ tex, display });
    return `@@MATH${maths.length - 1}@@`;
  });
  let html = DOMPurify.sanitize(marked.parse(protectedText), { USE_PROFILES: { html: true }, FORBID_TAGS: ["style", "form", "input", "img"] });
  html = html.replace(/@@MATH(\d+)@@/g, (_m, i) => {
    const item = maths[Number(i)];
    const rendered = item && renderMath(item.tex, item.display);
    if (rendered) return rendered;
    const escaped = document.createElement("span");
    escaped.textContent = item ? item.tex : "";
    return escaped.innerHTML;
  });
  return html;
}

export function renderMarkdown(el, text) {
  el.innerHTML = markdownToHtml(text);
  return el;
}
