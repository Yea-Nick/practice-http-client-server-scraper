const SERVER = localStorage.getItem("SERVER_URL") || "http://localhost:3000";

const kwEl = document.getElementById("kw");
const btnSearch = document.getElementById("btnSearch");
const urlsEl = document.getElementById("urls");
const searchErrorEl = document.getElementById("searchError");

const selectedUrlEl = document.getElementById("selectedUrl");
const btnDownload = document.getElementById("btnDownload");
const btnClear = document.getElementById("btnClear");

const progressEl = document.getElementById("progress");
const sizeInfoEl = document.getElementById("sizeInfo");
const progressTextEl = document.getElementById("progressText");
const downloadErrorEl = document.getElementById("downloadError");

const savedEl = document.getElementById("saved");
const viewerEl = document.getElementById("viewer");

let selectedUrl = null;

function setError(el, msg) {
    el.textContent = msg || "";
}

function bytesToHuman(n) {
    if (n == null) return "неизвестно";
    const units = ["B", "KB", "MB", "GB"];
    let i = 0;
    let v = n;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

function loadSaved() {
    const raw = localStorage.getItem("downloads");
    const list = raw ? JSON.parse(raw) : [];
    savedEl.innerHTML = "";

    if (!list.length) {
        savedEl.innerHTML = `<div class="muted">Пока ничего не скачано</div>`;
        return;
    }

    list.forEach((item, idx) => {
        const div = document.createElement("div");
        div.className = "item";
        div.innerHTML = `
      <div>
        <div><b>${item.title || item.url}</b></div>
        <div class="muted">${new Date(item.savedAt).toLocaleString()}</div>
      </div>
      <button data-idx="${idx}">Открыть</button>
    `;
        div.querySelector("button").onclick = () => {
            viewerEl.textContent = item.content;
        };
        savedEl.appendChild(div);
    });
}

function saveDownload(entry) {
    const raw = localStorage.getItem("downloads");
    const list = raw ? JSON.parse(raw) : [];
    list.unshift(entry);
    localStorage.setItem("downloads", JSON.stringify(list.slice(0, 30)));
}

function renderUrls(urls) {
    urlsEl.innerHTML = "";
    urls.forEach((u) => {
        const div = document.createElement("div");
        div.className = "item";
        div.innerHTML = `
      <div class="url">${u}</div>
      <button>Выбрать</button>
    `;
        div.querySelector("button").onclick = () => {
            selectedUrl = u;
            selectedUrlEl.textContent = `Выбран: ${u}`;
            btnDownload.disabled = false;
            setError(downloadErrorEl, "");
        };
        urlsEl.appendChild(div);
    });
}

btnSearch.onclick = async () => {
    setError(searchErrorEl, "");
    urlsEl.innerHTML = "";
    selectedUrl = null;
    selectedUrlEl.textContent = "URL не выбран";
    btnDownload.disabled = true;

    const kw = kwEl.value.trim().toLowerCase();
    if (!kw) {
        return setError(searchErrorEl, "Введите ключевое слово");
    }

    try {
        const r = await fetch(`${SERVER}/api/keywords/${encodeURIComponent(kw)}`);
        if (!r.ok) {
            const data = await r.json().catch(() => ({}));
            throw new Error(data.error || `Ошибка сервера: ${r.status}`);
        }
        const data = await r.json();
        renderUrls(data.urls);
    } catch (e) {
        setError(searchErrorEl, e.message);
    }
};

btnDownload.onclick = async () => {
    if (!selectedUrl) return;

    setError(downloadErrorEl, "");
    progressEl.max = 100;
    progressEl.value = 0;
    progressTextEl.textContent = "";
    sizeInfoEl.textContent = "";

    try {
        const r = await fetch(`${SERVER}/api/fetch?url=${encodeURIComponent(selectedUrl)}`);

        if (!r.ok) {
            const data = await r.json().catch(() => ({}));
            throw new Error(data.error || `Ошибка скачивания: ${r.status}`);
        }

        const ct = r.headers.get("content-type") || "";
        const contentLength = r.headers.get("content-length");
        const total = contentLength ? Number(contentLength) : null;

        if (!r.body || !r.body.getReader) {
            const buf = await r.arrayBuffer();
            const realSize = buf.byteLength;

            sizeInfoEl.textContent = `Скачано: ${bytesToHuman(realSize)}`;
            progressEl.value = 100;
            progressTextEl.textContent = "Готово";

            let content;
            if (ct.includes("text/") || ct.includes("json") || ct.includes("xml") || ct.includes("html")) {
                content = new TextDecoder("utf-8").decode(buf);
            } else {
                const b = new Uint8Array(buf);
                let s = "";
                for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
                content = `base64(${ct}):\n` + btoa(s);
            }

            saveDownload({ url: selectedUrl, title: selectedUrl, savedAt: Date.now(), sizeBytes: realSize, contentType: ct, content });
            loadSaved();
            viewerEl.textContent = content;
            return;
        }

        const reader = r.body.getReader();
        const chunks = [];
        let received = 0;

        if (!total) {
            progressEl.removeAttribute("value");
            progressTextEl.textContent = "загрузка…";
        }

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            chunks.push(value);
            received += value.byteLength;

            if (total) {
                const percent = Math.round((received / total) * 100);
                progressEl.value = Math.min(100, percent);
                progressTextEl.textContent = `${progressEl.value}%`;
                sizeInfoEl.textContent = `Размер: ${bytesToHuman(total)}; Скачано: ${bytesToHuman(received)}`;
            } else {
                sizeInfoEl.textContent = `Скачано: ${bytesToHuman(received)}`;
            }
        }

        const result = new Uint8Array(received);
        let offset = 0;
        for (const chunk of chunks) {
            result.set(chunk, offset);
            offset += chunk.byteLength;
        }
        const buf = result.buffer;

        const realSize = buf.byteLength;
        sizeInfoEl.textContent = `Скачано: ${bytesToHuman(realSize)}`;

        progressEl.max = 100;
        progressEl.value = 100;
        progressTextEl.textContent = "Готово";

        let content;
        if (ct.includes("text/") || ct.includes("json") || ct.includes("xml") || ct.includes("html")) {
            content = new TextDecoder("utf-8", { fatal: false }).decode(buf);
        } else {
            const b = new Uint8Array(buf);
            let s = "";
            for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
            content = `base64(${ct}):\n` + btoa(s);
        }

        saveDownload({
            url: selectedUrl,
            title: selectedUrl,
            savedAt: Date.now(),
            sizeBytes: realSize,
            contentType: ct,
            content
        });

        loadSaved();
        viewerEl.textContent = content;
    } catch (e) {
        setError(downloadErrorEl, e.message);
        progressEl.max = 100;
        progressEl.value = 0;
        progressTextEl.textContent = "";
    }
};


btnClear.onclick = () => {
    localStorage.removeItem("downloads");
    viewerEl.textContent = "";
    loadSaved();
};

loadSaved();
