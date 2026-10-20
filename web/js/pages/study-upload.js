// The drop zone on the Study page: drag and drop (or choose, or photograph) course files, then
// watch each one upload with its own progress bar. Uploads go one at a time so a slow Wi-Fi
// connection isn't split between them; the server reads each file in the background afterwards.

import { api, upload } from "../api.js";
import { prepareImage } from "../images.js";
import { clear, field, h, svgIcon, toast } from "../ui.js";
import { sizeText } from "./study-shared.js";

const ACCEPT = ".pdf,.pptx,.docx,.txt,.md,.markdown,.vtt,.srt,.png,.jpg,.jpeg,.webp,.gif,.mp3,.m4a,.wav,.ogg,.oga,.webm,.mp4,.mov,.aac,.flac";
const AUDIO = /\.(mp3|m4a|wav|ogg|oga|webm|mp4|mov|aac|flac)$/i;
const IMAGE = /\.(png|jpe?g|webp|gif|heic|heif)$/i;
const OLD_OFFICE = { ppt: ".pptx", doc: ".docx" };

/** Photos are shrunk in the browser (as on the Solve page): smaller uploads, and the model reads them just as well. */
async function shrinkPhoto(file) {
  const photo = await prepareImage(file);
  const bytes = Uint8Array.from(window.atob(photo.b64), (c) => c.charCodeAt(0));
  const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
  return new File([bytes], name, { type: "image/jpeg" });
}

function hasFiles(event) {
  return [...(event.dataTransfer?.types || [])].includes("Files");
}

/**
 * Draws the drop zone into `box`. `onUploaded(doc)` is called for each document the server accepts.
 * Returns nothing; the upload queue lives inside the box. Files dropped anywhere else on the page
 * are uploaded too: otherwise the browser would open the PDF in place of Learnly (or download the
 * .pptx), leaving the page and cancelling any uploads still waiting.
 */
export function renderUploader(box, { onUploaded, scenes, onCleanup }) {
  let limits = { docMb: 50, audioMb: 500 };
  api.get("/settings/public").then((s) => {
    limits = { docMb: s.max_upload_mb, audioMb: s.max_upload_mb * 10 };
    sizes.textContent = `Up to ${limits.docMb} MB each (recordings up to ${limits.audioMb} MB).`;
  }).catch(() => {});

  const input = h("input", { type: "file", multiple: true, accept: ACCEPT, hidden: true, "aria-label": "Choose files to upload" });
  const camera = h("input", { type: "file", accept: "image/*", capture: "environment", hidden: true, "aria-label": "Take a photo of your notes" });
  const subject = h("input", { type: "text", maxlength: 80, placeholder: "e.g. Biology", autocomplete: "off" });
  const queue = h("ul", { class: "upload-list", "aria-live": "polite" });
  const sizes = h("span", {}, "Up to 50 MB each (recordings up to 500 MB).");
  // Clicking anywhere in the zone opens the file chooser; keyboard users have the buttons.
  const zone = h("div", {
    class: "dropzone", role: "region", "aria-label": "Upload course files",
    onclick: (e) => { if (!e.target.closest("button")) input.click(); },
  },
  h("div", { class: "drop-icon", "aria-hidden": "true" }, "⇪"),
  h("p", { class: "drop-title" }, "Drop lecture slides, chapter PDFs or recordings here"),
  h("div", { class: "row drop-actions" },
    h("button", { class: "btn primary", type: "button", onclick: () => input.click() }, "Choose files"),
    h("button", { class: "btn", type: "button", onclick: () => camera.click() }, svgIcon("image"), "Photo of notes")),
  h("p", { class: "drop-types small muted" },
    "PDF · PowerPoint (.pptx) with speaker notes · Word (.docx) · text and subtitles (.txt .md .vtt .srt) · photos of notes · recordings (.mp3 .m4a .wav and more). ", sizes));

  let depth = 0;
  zone.addEventListener("dragenter", (e) => { e.preventDefault(); depth += 1; zone.classList.add("over"); });
  zone.addEventListener("dragover", (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; });
  zone.addEventListener("dragleave", () => { depth = Math.max(0, depth - 1); if (!depth) zone.classList.remove("over"); });
  zone.addEventListener("drop", (e) => {
    e.preventDefault();
    depth = 0;
    zone.classList.remove("over");
    addFiles([...(e.dataTransfer?.files || [])]);
  });
  const pageDragOver = (e) => {
    if (!hasFiles(e)) return; // dragging text into a box works as usual
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };
  const pageDrop = (e) => {
    if (!hasFiles(e) || e.defaultPrevented) return; // the drop zone has already taken it
    e.preventDefault();
    addFiles([...e.dataTransfer.files]);
    queue.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };
  document.addEventListener("dragover", pageDragOver);
  document.addEventListener("drop", pageDrop);
  onCleanup?.(() => {
    document.removeEventListener("dragover", pageDragOver);
    document.removeEventListener("drop", pageDrop);
  });
  input.addEventListener("change", () => { addFiles([...input.files]); input.value = ""; });
  camera.addEventListener("change", () => { addFiles([...camera.files]); camera.value = ""; });

  clear(box).append(zone, input, camera,
    h("div", { class: "upload-options" }, field("Subject for these files (optional)", subject, { hint: "Groups your documents. You can change it later." })),
    queue);

  const waiting = [];
  let running = false;

  function addFiles(files) {
    for (const file of files) {
      const ext = (file.name.split(".").pop() || "").toLowerCase();
      const item = queueItem(file);
      queue.prepend(item.el);
      if (OLD_OFFICE[ext]) {
        item.fail(`Old Office files can't be read. Save it as ${OLD_OFFICE[ext]} or PDF first.`);
        continue;
      }
      const limit = (AUDIO.test(file.name) ? limits.audioMb : limits.docMb) * 1024 * 1024;
      if (file.size > limit && !IMAGE.test(file.name)) {
        item.fail(`Too large: the limit is ${Math.round(limit / 1024 / 1024)} MB.`);
        continue;
      }
      waiting.push({ file, item, subject: subject.value.trim() });
    }
    next();
  }

  async function next() {
    if (running || !waiting.length) return;
    running = true;
    const { file, item, subject: subjectText } = waiting.shift();
    try {
      let body = file;
      if (IMAGE.test(file.name) || /^image\//.test(file.type)) {
        item.status("Preparing the photo…");
        body = await shrinkPhoto(file);
      }
      const query = new URLSearchParams({ filename: body.name || file.name });
      if (subjectText) query.set("subject", subjectText);
      const doc = await upload(`/study/documents?${query}`, body, { onProgress: (p) => item.progress(p) });
      item.done(doc);
      scenes?.pulse("celebrate");
      onUploaded(doc);
    } catch (err) {
      item.fail(err.message);
    } finally {
      running = false;
      next();
    }
  }

  function queueItem(file) {
    const bar = h("span", { style: { width: "0%" } });
    const text = h("span", { class: "small muted" }, "Waiting to upload");
    const el = h("li", { class: "upload-item" },
      h("div", { class: "row between" }, h("b", { class: "upload-name" }, file.name), h("span", { class: "small faint" }, sizeText(file.size))),
      h("div", { class: "progress", role: "progressbar", "aria-label": `Uploading ${file.name}`, "aria-valuemin": "0", "aria-valuemax": "100" }, bar),
      text);
    const progressEl = el.querySelector(".progress");
    return {
      el,
      status(message) {
        text.textContent = message;
      },
      progress(p) {
        const pct = Math.round(p * 100);
        bar.style.width = `${pct}%`;
        progressEl.setAttribute("aria-valuenow", String(pct));
        text.textContent = pct < 100 ? `Uploading… ${pct}%` : "Uploaded. Saving…";
      },
      done(doc) {
        bar.style.width = "100%";
        el.classList.add("ok");
        text.textContent = `Uploaded. Learnly is reading “${doc.title}” now (see below).`;
        setTimeout(() => el.remove(), 6000);
      },
      fail(message) {
        el.classList.add("bad");
        text.textContent = message;
        text.setAttribute("role", "alert");
        progressEl.hidden = true;
        toast(`${file.name}: ${message}`, "bad");
      },
    };
  }
}
