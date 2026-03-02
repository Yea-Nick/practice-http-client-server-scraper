import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import { randomUUID } from "crypto";
import fs from "fs";

const app = express();
app.use(cors());
app.use(express.json());

const keywords = JSON.parse(fs.readFileSync(new URL("./keywords.json", import.meta.url)));

const progressMap = new Map();

app.get("/api/keywords/:kw", (req, res) => {
    const kw = (req.params.kw || "").trim().toLowerCase();
    const urls = keywords[kw];
    if (!urls) {
        return res.status(404).json({ error: `Ключевое слово не найдено: ${kw}` });
    }
    res.json({ keyword: kw, urls });
});

app.get("/api/fetch-status/:id", (req, res) => {
    const id = req.params.id;

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const send = () => {
        const st = progressMap.get(id);
        if (!st) {
            res.write(`event: error\ndata: ${JSON.stringify({ error: "Unknown downloadId" })}\n\n`);
            res.end();
            return;
        }
        res.write(`data: ${JSON.stringify(st)}\n\n`);
        if (st.done || st.error) {
            res.end();
        }
    };

    const timer = setInterval(send, 300);
    req.on("close", () => clearInterval(timer));
});

app.get("/api/fetch", async (req, res) => {
    const url = req.query.url;
    if (!url || typeof url !== "string") {
        return res.status(400).json({ error: "Параметр url обязателен" });
    }
    if (!/^https?:\/\//i.test(url)) {
        return res.status(400).json({ error: "Разрешены только http/https URL" });
    }

    const downloadId = randomUUID();
    progressMap.set(downloadId, {
        total: null,
        downloaded: 0,
        percent: null,
        done: false,
        error: null
    });

    res.setHeader("X-Download-Id", downloadId);

    let upstream;
    try {
        upstream = await fetch(url, { redirect: "follow" });
    } catch (e) {
        progressMap.set(downloadId, { total: null, downloaded: 0, percent: null, done: false, error: "Fetch failed" });
        return res.status(502).json({ error: "Не удалось скачать URL (fetch error)" });
    }

    if (!upstream.ok) {
        progressMap.set(downloadId, { total: null, downloaded: 0, percent: null, done: false, error: `Upstream status ${upstream.status}` });
        return res.status(502).json({ error: `Upstream ответил статусом ${upstream.status}` });
    }

    const st = progressMap.get(downloadId);

    const contentType = upstream.headers.get("content-type") || "application/octet-stream";
    const contentLength = upstream.headers.get("content-length");
    st.total = contentLength ? Number(contentLength) : null;

    res.setHeader("Content-Type", contentType);
    if (contentLength) res.setHeader("Content-Length", contentLength);

    res.flushHeaders?.();

    upstream.body.on("data", (chunk) => {
        st.downloaded += chunk.length;
        if (st.total) st.percent = Math.round((st.downloaded / st.total) * 100);

        res.write(chunk);
    });

    upstream.body.on("end", () => {
        st.done = true;
        res.end();
    });

    upstream.body.on("error", () => {
        st.error = "Stream error";
        if (!res.headersSent) res.status(500);
        res.end();
    });
});


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on :${PORT}`));