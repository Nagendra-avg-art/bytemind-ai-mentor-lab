# 🧠 Secure Full-Stack Gemini AI Starter (React + Node.js + TypeScript)

A clean, beginner-friendly full-stack application for learning **LLM API integration** using Google's official `@google/genai` SDK and React.

---

## 🔒 Security Architecture (Why Server-Side?)

```text
[ iQOO Phone / Browser ]
           │
           │ POST /api/ask { question }
           ▼
[ Vite Dev Server :5173 ] ──── (Internal Proxy) ────► [ Express Server :3001 ]
                                                            │
                                                            │ Uses GEMINI_API_KEY from .env
                                                            ▼
                                                  [ Google Gemini API ]
                                                  (@google/genai SDK)
```

1. **API Key Security**: The `GEMINI_API_KEY` is loaded by Node.js from the root `.env` file. It is **never** bundled or exposed to the client or browser.
2. **Seamless Mobile Testing**: The Vite dev server proxies `/api` requests to the Express server on port `3001`. When testing on an iQOO phone over local Wi-Fi, the phone talks to the single Vite host URL (`http://<PC_IP>:5173`), eliminating mobile CORS issues.

---

## 📱 Mobile-Friendly Design (Tested for iQOO Phones)
- **Touch Targets:** Buttons and interactive elements are sized at $\ge 48\text{px}$ for comfortable thumb tapping.
- **Input Zoom Prevention:** Text inputs use a 16px base font to prevent mobile Chrome from auto-zooming.
- **Sample Prompt Chips:** Tap pre-written questions with a single click instead of typing on a phone keyboard.
- **Full-width Adaptive Button:** The "Ask AI" button stretches to full-width on mobile screens ($\le 480\text{px}$).

---

## 📁 Complete File Guide & Architecture

| File / Folder | Purpose & Architectural Role |
| :--- | :--- |
| [`.env`](./.env) | **Secret Environment File.** Stores `GEMINI_API_KEY` and `PORT`. Ignored by Git to prevent exposing your credentials. |
| [`.env.example`](./.env.example) | Safe template documenting the environment variables needed by the backend. |
| [`.gitignore`](./.gitignore) | Explicitly ignores `.env`, `.env.local`, `node_modules/`, and `dist/`. |
| [`server/index.js`](./server/index.js) | **Backend Server.** An Express server that imports `@google/genai`, validates requests, verifies the presence of `GEMINI_API_KEY`, calls the `gemini-3.6-flash` model via the Interactions API, and provides `GET /api/health` and `POST /api/ask`. |
| [`server/prompts/mentorPrompt.js`](./server/prompts/mentorPrompt.js) | **System Instructions.** Houses the modular, reusable persona for "ByteMind AI Mentor" with tailored pedagogical rules for CS students, analogies, exam prep, and interactive practice challenges. |
| [`package.json`](./package.json) | Lists dependencies (`@google/genai`, `express`, `cors`, `dotenv`, `react`, `react-dom`) and runs both frontend and backend concurrently via `npm run dev`. |
| [`vite.config.ts`](./vite.config.ts) | Configures Vite, enables `host: true` for mobile access, and sets up a proxy mapping `/api` $\to$ `http://localhost:3001`. |
| [`tsconfig.json`](./tsconfig.json) | TypeScript compiler options (strict typing, React JSX transform, ES2020 target). |
| [`tsconfig.node.json`](./tsconfig.node.json) | TypeScript configuration specifically for Vite tooling files. |
| [`index.html`](./index.html) | HTML entry point with `<meta name="viewport">` mobile scaling and root mounting element. |
| [`src/main.tsx`](./src/main.tsx) | React DOM entry point that initializes `ReactDOM.createRoot` inside `React.StrictMode`. |
| [`src/App.tsx`](./src/App.tsx) | Main UI orchestrator managing prompt state, loading spinners, sample chips, and error display. |
| [`src/types.ts`](./src/types.ts) | TypeScript interfaces for request lifecycle states (`RequestStatus`, `AIResponseState`). |
| [`src/services/aiService.ts`](./src/services/aiService.ts) | **Frontend API Layer.** Calls `POST /api/ask` using `fetch()`. Formats server responses and surfaces actionable errors to the UI. |
| [`src/components/QuestionInput.tsx`](./src/components/QuestionInput.tsx) | Textarea input with `Enter` key submission and the **"Ask AI"** button. |
| [`src/components/ResponseDisplay.tsx`](./src/components/ResponseDisplay.tsx) | Multi-state viewer: Idle, Loading (pulsing dots), Error banner, and Success card with a Copy button. |
| [`src/index.css`](./src/index.css) | Global styles, typography, and mobile tap resets. |
| [`src/App.css`](./src/App.css) | Responsive component layout, card styles, and mobile media queries. |

---

## 🚀 How to Run the Application

### 1. Add your Gemini API Key
1. Get a free API key from [Google AI Studio](https://aistudio.google.com/apikey).
2. Open the `.env` file in the project root:
   ```env
   GEMINI_API_KEY=AIzaSy...your_actual_key_here...
   PORT=3001
   ```

### 2. Generate Local HTTPS Certificates (One-Time Setup)
To support microphone input and speech recognition on physical mobile devices (e.g. iQOO phone), Vite runs over HTTPS with locally trusted development certificates:
```bash
npm run certs
```
This automatically uses `mkcert` (included in `certs/mkcert.exe`) to generate:
- **Server Certificate:** `certs/bytemind-cert.pem` & `certs/bytemind-key.pem` valid for `localhost`, `127.0.0.1`, and `192.168.0.123`.
- **Root CA:** `certs/rootCA.crt` (and `certs/rootCA.pem`).

To install the CA into Windows so Chrome/Edge on your PC trusts it automatically without warnings:
```powershell
.\certs\mkcert.exe -install
```
(When the Windows Security Warning pop-up appears, click **Yes**).

### 3. Start Both Backend & Frontend
Run a single command:
```bash
npm run dev
```

`concurrently` starts:
- **Express Backend:** listening on `http://localhost:3001` (internal API)
- **Vite Frontend:** listening on HTTPS with reverse proxy `/api` -> `http://localhost:3001`

```text
[server] 🚀 Gemini API backend server listening on http://localhost:3001
[client] ➜  Local:   https://localhost:5173/ (or https://localhost:5174/)
[client] ➜  Network: https://192.168.0.123:5173/ (or https://192.168.0.123:5174/)
```

---

## 📱 Testing on Your iQOO Phone (Microphone & Secure Context)

Mobile browsers require a **Secure Context** (`window.isSecureContext === true`) to enable `navigator.mediaDevices` and the Web Speech API. ByteMind provides local HTTPS to meet this requirement.

### 1. Network Connection
1. Ensure your iQOO phone is connected to the **same Wi-Fi network** as your laptop.
2. The phone access URL is:
   ```text
   https://192.168.0.123:5173
   ```
   *(or port `5174` if port `5173` is occupied).*

### 2. Trusting the Local Certificate on iQOO (Android / Funtouch OS)

#### Option A: Quick Proceed (Instant, No Installation Needed)
1. Open Chrome on your iQOO phone and go to `https://192.168.0.123:5173`.
2. You may see a Chrome warning: *"Your connection is not private"* (due to the self-signed local CA).
3. Tap **Advanced** at the bottom.
4. Tap **Proceed to 192.168.0.123 (unsafe)**.
5. Chrome will establish an HTTPS session and activate **Secure Context** (`isSecureContext === true`), allowing you to grant microphone permissions immediately!

#### Option B: Full Root CA Installation (Clean & Warning-Free)
To make Chrome completely trust the local HTTPS connection without any warning:
1. **Transfer the CA certificate:** Send [`certs/rootCA.crt`](./certs/rootCA.crt) (or `certs/ByteMind-Local-CA.crt`) to your phone (via USB, Quick Share, Google Drive, or email).
2. **On your iQOO phone:**
   - Open **Settings** -> **Security** (or **Security & Privacy**).
   - Tap **More security settings** -> **Encryption & credentials** (or search "credentials" in Settings).
   - Tap **Install a certificate** (or **Install from storage**).
   - Select **CA certificate**.
   - If prompted with *"Your data won't be private"*, tap **Install anyway**.
   - Browse and select `rootCA.crt` from your Downloads/Storage.
   - Name it `ByteMind mkcert CA` and confirm with your device PIN.
3. Open `https://192.168.0.123:5173` in Chrome. You will see a secure lock icon, and microphone/speech recognition will work seamlessly!

### 3. Verify Diagnostics on Phone
When opening `https://192.168.0.123:5173`, verify:
- **Secure Context:** YES (`true`)
- **Protocol:** `https:`
- **MediaDevices:** YES (`navigator.mediaDevices` available)
- **Speech Recognition:** YES
- **Permission:** `prompt` or `granted`

> **Note:** The backend remains securely on `localhost:3001` on your laptop; all frontend requests to `/api` are handled by Vite's secure reverse proxy so port 3001 is never directly exposed to the mobile network.
