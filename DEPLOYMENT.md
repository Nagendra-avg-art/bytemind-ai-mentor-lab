# ByteMind AI Mentor — Public Production Deployment Guide

This guide details how to deploy ByteMind as a **unified, single-service Web Service on Render** (`https://render.com`).

---

## 1. Architecture Overview

ByteMind is configured as a single Node.js web service that serves both:
1. **Frontend:** Production-compiled Vite/React bundle (`dist/`) served as static files and client-side SPA routing.
2. **Backend:** Express API (`/api/*`) communicating server-side with Google Gemini models, RAG vector retrieval, and Step 15 Local AI intent classification.

```
                  ┌──────────────────────────────────────────────┐
                  │          PUBLIC HTTPS TRAFFIC                │
                  │  https://bytemind-ai-mentor.onrender.com     │
                  └──────────────────────┬───────────────────────┘
                                         │
                             Render Managed TLS / SSL
                                         │
                                         ▼
                  ┌──────────────────────────────────────────────┐
                  │         RENDER WEB SERVICE CONTAINER         │
                  │              Node.js Runtime                 │
                  │                                              │
                  │  Express Production Server (0.0.0.0:$PORT)   │
                  │                                              │
                  │  ├── Static Files & SPA (/*)  ──► dist/      │
                  │  │   • Student Mode UI                       │
                  │  │   • Classroom Mode UI                     │
                  │  │   • Mobile Responsive Shell               │
                  │  │                                           │
                  │  └── API Endpoints (/api/*)                  │
                  │      • /api/health                           │
                  │      • /api/ask                              │
                  │      • /api/rag/ask                          │
                  │      • /api/image/ask                        │
                  │      • /api/agent/learn                      │
                  │      • /api/agent/classroom                  │
                  │      • /api/local-ai/*                       │
                  │                                              │
                  │  └── Secure Server-Side Integrations         │
                  │      • Google Gemini API (GEMINI_API_KEY)    │
                  │      • Local AI Classifier (ONNX CPU)        │
                  │      • In-Memory / pgvector Store            │
                  └──────────────────────────────────────────────┘
```

### Why Single-Service on Render?
* **Zero CORS & Zero Proxy Fragility:** The frontend and backend share the exact same origin. API calls use native relative paths (`/api/ask`, `/api/rag/ask`, etc.).
* **Instant Mobile Secure Context:** Render automatically provisions a public trusted SSL certificate (`https://*.onrender.com`). Mobile browsers (including Android Chrome and iOS Safari) enable `navigator.mediaDevices` and Web Speech APIs without requiring self-signed certificates or `mkcert`.
* **Zero Gemini Key Leakage:** `GEMINI_API_KEY` is loaded purely into Node's server-side `process.env`. It is never bundled into client JavaScript.

---

## 2. Step 1: GitHub Repository Preparation

If your project is not yet on GitHub:

1. Open a terminal in the project root (`d:\ByteMind-AI-Lab`):
   ```bash
   git init
   git branch -M main
   ```

2. Verify that sensitive files are ignored:
   ```bash
   git status
   ```
   **Ensure that `.env`, `.env.*`, `node_modules`, `dist`, and `certs/` are NOT listed in untracked files.**

3. Add and commit all project files:
   ```bash
   git add .
   git commit -m "feat: prepare ByteMind for public single-service Render deployment"
   ```

4. Create a new repository on GitHub (e.g. `bytemind-ai-mentor`), link your local repository, and push:
   ```bash
   git remote add origin https://github.com/<YOUR_GITHUB_USERNAME>/bytemind-ai-mentor.git
   git push -u origin main
   ```

---

## 3. Step 2: Create Render Web Service

1. Go to [dashboard.render.com](https://dashboard.render.com) and log in or sign up.
2. Click the blue **New +** button in the top right and select **Web Service**.
3. Under **Connect a repository**, select your `bytemind-ai-mentor` repository (if prompted, grant Render access to your GitHub account).
4. Click **Connect**.

---

## 4. Step 3: Exact Render Settings

Fill out the Web Service configuration form with these exact settings:

| Setting | Exact Value to Enter | Notes |
| :--- | :--- | :--- |
| **Name** | `bytemind-ai-mentor` | Your URL will be `https://<Name>.onrender.com` |
| **Region** | *Nearest to you* (e.g., Singapore, Frankfurt, Oregon, Ohio) | Select the region closest to your audience |
| **Branch** | `main` | Production branch |
| **Root Directory** | *(Leave blank)* | Uses root of the repository |
| **Runtime** | `Node` | Standard Node.js environment |
| **Build Command** | `npm install && npm run build` | Installs dependencies and runs `tsc && vite build` |
| **Start Command** | `npm start` | Runs `node server/index.js` in production mode |
| **Instance Type / Plan**| **Free** | Generous free tier with HTTPS included |

---

## 5. Step 4: Environment Variables

Click the **Environment** tab (or scroll down to **Environment Variables**) in the Render configuration and add the following keys:

| Key | Example Value | Description |
| :--- | :--- | :--- |
| `GEMINI_API_KEY` | `AIzaSy...` (Your actual key) | **Required.** Your Google Gemini API Key from [aistudio.google.com/apikey](https://aistudio.google.com/apikey). |
| `NODE_ENV` | `production` | Optimizes Express and dependencies for production performance. |
| `LOCAL_AI_EXPERIMENT` | `true` | Enables Step 15 Local AI intent routing (runs host CPU ONNX). |

> [!CAUTION]
> **Never** add environment variables prefixed with `VITE_` containing secrets. `GEMINI_API_KEY` must remain strictly server-side.

---

## 6. Step 5: Deploy & Monitor

1. Click **Create Web Service** (or **Save Changes**).
2. Render will automatically initiate the build log:
   - `npm install` installs dependencies (including `@google/genai`, `@xenova/transformers`, `express`, etc.).
   - `npm run build` runs `tsc && vite build`, creating `dist/`.
   - `npm start` launches `server/index.js`.
3. In the Render deploy console, you should see:
   ```
   ==> Running 'npm run build'
   ✓ built in 870ms
   ==> Starting service with 'npm start'
   > node server/index.js
   🚀 ByteMind server listening on http://0.0.0.0:10000
   🔑 GEMINI_API_KEY status: Configured
   🗄️ Vector Storage: In-Memory Fallback
   📦 Production Frontend: Enabled (dist/)
   ==> Your service is live 🎉
   ```
4. Render will provide your public URL at the top of the dashboard:
   ```
   https://bytemind-ai-mentor.onrender.com
   ```

---

## 7. Step 6: Post-Deployment Verification Checklist

Verify the public deployment from both your laptop browser and a physical mobile phone:

### 1. Automated Health & API Check
Open in your browser:
* `https://<YOUR-RENDER-APP>.onrender.com/api/health`
  - **Expected:** `{"status":"ok","apiKeyConfigured":true,"dbConfigured":false,"storageMode":"memory","geminiStatus":"AVAILABLE"}`
* `https://<YOUR-RENDER-APP>.onrender.com/api/local-ai/status`
  - **Expected:** `{"enabled":true,"model":"Xenova/all-MiniLM-L6-v2","runtime":"ONNX Runtime / Transformers.js (Host CPU Local Inference)","status":"Ready",...}`

### 2. Student Mode & Mobile Verification
* Open `https://<YOUR-RENDER-APP>.onrender.com` on your phone browser.
* Verify that the UI renders the clean **Student Mode** view.
* Tap the 📷 **Camera** button: verify that camera capture triggers.
* Tap the 🎤 **Microphone** button: verify that Speech Recognition is permitted (because the connection is trusted public HTTPS).
* Test asking a question: verify that the answer renders with step-by-step guidance.

### 3. Classroom Mode & SPA Routing
* Open `https://<YOUR-RENDER-APP>.onrender.com/classroom` directly.
* Verify that the page loads without 404 errors (SPA fallback functional).
* Test uploading a lecture PDF and running the **Summary** or **Assessment** actions.

### 4. Developer Mode Telemetry
* Tap the **🛠️ Developer Mode** toggle in the top-right corner.
* Switch to the **🧪 Local AI (/api/local-ai)** tab.
* Test clicking prompt chips (e.g. *"Explain 3NF"*) and verify local ONNX classification latency (~4ms) and zero token consumption.

---

## 8. Important Production Notes & FAQ

### Render Free Tier Spin-Down (Cold Starts)
* Render's Free tier automatically spins down web services after **15 minutes of inactivity**.
* When a student opens the URL after an idle period, the first request may take **~45–60 seconds** while Render spins up the container. Subsequent requests respond in milliseconds.
* *Hackathon Tip:* Open the URL 2 minutes before your live demo presentation to ensure the instance is awake and warm!

### Gemini Rate Limit Guardrails
* ByteMind's backend incorporates strict rate-limiting guardrails:
  - If the Gemini daily quota is reached, ByteMind stops retries immediately and displays a friendly notice (*"Gemini daily quota has been reached..."*).
  - No infinite loading spinners will occur.

---

**ByteMind AI Mentor** — *See. Ask. Learn.*
