# ByteMind AI Mentor — Hackathon Blueprint & Rebuild Plan

> **Tagline:** *See. Ask. Learn.*  
> **Target Audience:** College engineering students, self-directed learners, and educators.  
> **Platform Strategy:** Phone-first multimodal learning mentor with LAN host connectivity.

---

## 1. Product Identity

* **Product Name:** **ByteMind AI Mentor**
* **Tagline:** **See. Ask. Learn.**
* **Mission:** Transform passive study materials (diagrams, textbooks, handwritten notes, lecture slides) into an active, conversational, personalized tutoring experience right from the student's phone.

---

## 2. Problem Statement

Modern college students study across fragmented, physical, and visual mediums:
* **Printed textbooks & reference manuals**
* **Handwritten classroom lecture notes**
* **Whiteboard formulas and system architecture diagrams**
* **Professor lecture slides (PDF/PPT)**
* **Previous years' university question papers (PYQs)**

### The Friction in Existing Solutions
Generic AI chatbots (e.g., standard desktop chat interfaces) fail students during active revision:
1. **Context Typing Burden:** Transcribing complex diagrams, mathematical equations, or multi-step database normalization tables into text prompts is tedious and time-consuming.
2. **Loss of Personal Grounding:** Generic LLMs provide abstract, textbook-agnostic answers that often contradict the specific terminology, syllabus notation, or lecture emphasis expected in exams.
3. **Desktop Detachment:** Students study with paper and notebooks on their physical desks, where a handheld phone with a camera is far more natural than sitting in front of a laptop keyboard.

---

## 3. Core Solution

A **Phone-First Multimodal Learning Mentor** that merges:
1. **Camera Vision Input:** Capture any physical book, notebook diagram, or slide instantly without manual typing.
2. **Voice & Text Prompting:** Fluid, natural questioning using handheld voice recognition or quick typing.
3. **Grounded Student Material (RAG):** Answers anchored strictly in the student’s specific syllabus, lecture slides, and notes.
4. **Structured Agentic Learning Workflows:** Rather than generic chatting, ByteMind drives goal-oriented pedagogical loops: *Explain*, *Revise*, *Practice*, and *Quiz*.

---

## 4. The Core Loop

```
 ┌─────────────────────────────────────────────────────────────┐
 │                      THE CORE LOOP                          │
 │                                                             │
 │   📷 SEE    ──►   Capture study material, diagram, notes    │
 │       │                                                     │
 │       ▼                                                     │
 │   🎤 ASK    ──►   Speak or type question naturally          │
 │       │                                                     │
 │       ▼                                                     │
 │   🧠 LEARN  ──►   Multimodal grounded explanation + roadmap │
 └─────────────────────────────────────────────────────────────┘
```

* **SEE:** The phone camera captures physical study material (e.g., a normalization table or schema diagram). Client-side canvas compression optimizes the image under 500KB in `<150ms`.
* **ASK:** The student asks via microphone or text: *"Explain 3NF based on this schema and show where transitive dependency happens."*
* **LEARN:** The backend combines multimodal vision understanding with ingested PDF lecture context (RAG) through a controlled Learning Agent to deliver a structured, milestone-driven explanation.

---

## 5. Feature Priority Matrix (Hackathon Build Tiers)

```
┌───────────────────────────────────────────────────────────────────────────────┐
│                                FEATURE TIERS                                  │
├───────────────────────────────────────────────────────────────────────────────┤
│  P0 (MUST BUILD)        Student Mode, Camera input, Text input, AI            │
│                         Explanation, RAG over study notes, Controlled Agent,  │
│                         Multi-turn Context, Mobile-First responsive UI        │
├───────────────────────────────────────────────────────────────────────────────┤
│  P1 (BUILD IF TIME)     Classroom Assistant (Lecture Slide to Quiz/Summary),  │
│                         Explicit Revision Workflow, Practice Question Tool,   │
│                         Local AI Intent Router Experiment (Step 15)           │
├───────────────────────────────────────────────────────────────────────────────┤
│  P2 (TIME PERMITTING)   Snapdragon NPU acceleration, Advanced animations,     │
│                         Comprehensive student analytics, Extra export formats │
└───────────────────────────────────────────────────────────────────────────────┘
```

### P0 — MUST BUILD (Core Demo Viability)
* **Student Mode UI:** Clean, distraction-free, touch-friendly mobile interface.
* **Camera Capture & Upload:** Direct camera access (`capture="environment"`) with client-side image compression.
* **Text & Voice Input:** Resilient input bar supporting speech recognition and text fallback.
* **Multimodal AI Grounding:** Gemini 3.5 Flash vision + text processing.
* **RAG over Study Material:** Vector embedding (768-D) + cosine similarity retrieval over uploaded course notes.
* **Controlled Learning Agent:** Deterministic tool selection avoiding uncontrolled loop runaway.
* **Multi-Turn Conversation Memory:** Persistent `interactionId` session management.
* **Mobile-First Responsive Layout:** Designed specifically for handheld phone viewports (360px–430px).

### P1 — BUILD IF TIME (High-Impact Differentiators)
* **Classroom Assistant:** Transform uploaded lecture slides into summaries, discussion topics, and assessments in one click.
* **Revision Plan Generator:** High-yield exam checklists and memory recall points.
* **Interactive Quizzer:** Instant concept checks with targeted feedback.
* **Local AI Intent Classifier (Step 15):** On-device/host-side quantized ONNX model for 0-quota intent routing.

### P2 — ONLY IF TIME REMAINS (Polish & Extensions)
* Native Android wrapper or hardware acceleration.
* Complex animated milestone transitions.
* Long-term progress analytics and grade tracking.
* Additional classroom grading or export features.

---

## 6. System Architecture & Data Flow

```
┌───────────────────────────────────────────────────────────────────────────────┐
│                          BYTEMIND SYSTEM TOPOLOGY                             │
└───────────────────────────────────────────────────────────────────────────────┘

  [ Physical iQOO / Android Phone ]
       │
       │  Wi-Fi LAN: http://192.168.0.123:5173
       ▼
  [ Vite Dev Server & Reverse Proxy (:5173) ]
       │
       │  Internal Proxy: /api/*  ──►  http://localhost:3001
       ▼
  [ Node.js / Express Backend (:3001) ]
       ├── CORS & LAN Binder (0.0.0.0:3001)
       ├── Session & State Management
       │
       ├──► [ Local AI Classifier (Step 15) ] ── (Host CPU ONNX / Xenova)
       │         └── 0 Gemini tokens; classifies intent in ~4ms
       │
       ├──► [ Learning Agent Controller ]
       │         ├── Intent Detection (Local Model ──► Rule Fallback)
       │         └── Deterministic Tool Router (EXPLAIN, QUIZ, REVISION, PRACTICE)
       │
       ├──► [ RAG Vector Store Engine ]
       │         ├── Chunking & 768-D Embeddings
       │         └── In-Memory / PostgreSQL Vector Similarity Search
       │
       └──► [ Agent Gemini Client ]
                 ├── Model: gemini-3.5-flash
                 ├── Strict Rate Limit (RPM) Backoff (Max 1 retry)
                 └── Terminal Quota Error Trapping (0 retries on RPD)
                         │
                         ▼
             [ Google Gemini API Cloud ]
```

### End-to-End Request Trace
1. **Capture:** Student taps 📷 on their phone and captures a book diagram.
2. **Client Processing:** Canvas downsamples image to max 1280px dimension, converting to JPEG format `<500KB`.
3. **Network Transit:** Request traverses LAN to Vite reverse proxy (`:5173/api/image/ask`) and forwards to Express (`:3001`).
4. **Intent & Vector Routing:** The Learning Agent checks for matching lecture chunks via cosine similarity over 768-D embeddings.
5. **Multimodal Synthesis:** Gemini processes the image along with retrieved syllabus chunks and prompt instructions.
6. **Structured Response:** Returns clean Markdown, conceptual milestones, follow-up chips, and multi-turn session ID.

---

## 7. Phone-Specific Demo Strategy

The mobile phone must be demonstrated as an **active sensor and input tool**, not merely a passive display.

### Three Rules for the Mobile Demo:
1. **Camera is the Protagonist:** The presenter holds the physical phone, points the camera at a real piece of paper / laptop screen displaying a complex diagram, and snaps the photo live.
2. **Natural Multimodal Interaction:** After snapping the image, the presenter speaks or types: *"Explain why this table violates 2NF and how to reach 3NF."*
3. **No Awkward Typing on Stage:** Use pre-tested prompt chips or brief voice prompts to keep the live demo brisk and fault-free.

---

## 8. Classroom Mode Strategy (Controlled Scope)

> **CRITICAL RULE:** Do NOT attempt to build a full Learning Management System (LMS).

### The Single Winning Classroom Workflow:
* **Concept:** *"Lecture Ingestion to Student Readiness in 10 Seconds."*
* **Inputs:** Professor uploads the day’s lecture slide PDF (e.g., `dbms-normalization.pdf`).
* **Outputs (One-Click Actions):**
  1. 📋 **Classroom Summary:** Executive concept brief highlighting core learning outcomes.
  2. 🔍 **Key Topics Identified:** Breakdown of foundational vs. advanced concepts.
  3. 📝 **Assignment Generation:** Practical homework exercises directly grounded in the lecture.
  4. 🎯 **Quick Assessment:** 5-question exam-prep diagnostic quiz.

---

## 9. Local AI Strategy (Experimental Edge)

* **Classification Role:** Step 15 proved that lightweight intent routing (`Xenova/all-MiniLM-L6-v2`, ~23MB ONNX) runs locally in **~4ms on CPU** with **zero Gemini API quota consumed**.
* **Hackathon Posture:** Treat local AI as an impressive **technical bonus / architectural layer**.
* **Golden Rule:** Never compromise or delay the working Gemini cloud multimodal experience for local inference.
* **Disclaimer Rule:** Clearly state during judging: *"This is a host-side CPU ONNX experiment demonstrating offline routing; native Snapdragon NPU execution is on the future roadmap."*

---

## 10. Golden Path Demo Story (5-Minute Pitch Script)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                            5-MINUTE DEMO RUNBOOK                             │
└──────────────────────────────────────────────────────────────────────────────┘

 [00:00 - 00:45] THE HOOK (The Real Student Problem)
 • Presenter holds physical textbook/notes.
 • "Students don't study in pure text. They study with diagrams, slides, and notes.
    Typing this into a chat box is impossible. Meet ByteMind: See. Ask. Learn."

 [00:45 - 02:00] THE "SEE & ASK" MOMENT (Live Camera + Multimodal)
 • Presenter opens http://192.168.0.123:5173 on the physical phone.
 • Taps 📷 Camera, captures an unnormalized database table with functional dependencies.
 • Voice/Prompt: "Explain this step-by-step and show why it violates 2NF."
 • ByteMind analyzes the image, identifies partial dependencies, and explains it clearly.

 [02:00 - 03:15] THE "LEARN" AGENT & GROUNDED RAG
 • Presenter taps quick coach chip: "🔄 Revise" or "📝 Quiz".
 • ByteMind switches into Learning Coach mode, generating structured milestones grounded
   in the uploaded course syllabus.
 • Shows conversational continuity without re-uploading the image.

 [03:15 - 04:15] CLASSROOM ASSISTANT VALUE
 • Presenter toggles Classroom view:
 • "For professors: upload the lecture PDF ──► instant summary, assignment, and quiz."
 • Generates ready-to-use assessment in 4 seconds.

 [04:15 - 05:00] ARCHITECTURE & WRAP-UP
 • Highlight: Phone-first + Multimodal RAG + Controlled Agents + Local AI feasibility.
 • Closing punchline: "ByteMind AI Mentor: See. Ask. Learn."
```

---

## 11. Failure Modes & Resilient Fallback Matrix

During a live hackathon demo, network hiccups or quota limits can happen. ByteMind must degrade gracefully without infinite loading spinners or app crashes.

| Failure Scenario | Failure Symptom | Resilient ByteMind Fallback Behavior |
| :--- | :--- | :--- |
| **Gemini 429 Quota Exceeded** | Daily RPD or transient RPM limit hit | Stop retries immediately; show clean yellow/red alert; keep conversation intact; zero infinite spinner. |
| **Wi-Fi / LAN Network Drop** | Phone loses Wi-Fi connection | Display friendly banner: *"ByteMind can't reach the learning server. Check connection."* Keep chat history in `sessionStorage`. |
| **RAG / Vector Store Down** | Vector search fails or no document uploaded | Gracefully fall back to General CS Mentor explanation using pure Gemini intelligence. |
| **Phone Camera Blocked** | Browser permissions denied or camera unavailable | File picker fallback triggers automatically allowing image selection from gallery/disk. |
| **Microphone / Voice Speech Error** | Ambient noise or Web Speech API unavailable | Speech recognition silently resets to idle; student continues smoothly via text input. |
| **Local AI Model Fails** | ONNX initialization error or flag disabled | System automatically routes through deterministic keyword router (`detectIntent()`) in 1ms. |

---

## 12. Explicit Anti-Goals (DO NOT BUILD)

To ensure delivery within strict hackathon timeframes, avoid scope creep:

* ❌ **DO NOT build a full LMS:** No user registration gates, gradebooks, or role hierarchy.
* ❌ **DO NOT build an attendance system:** Irrelevant to the core learning loop.
* ❌ **DO NOT build a timetable or calendar:** Solved problem that distracts from AI innovation.
* ❌ **DO NOT build a social network:** No friend requests, student feeds, or direct messaging.
* ❌ **DO NOT build a placement / job portal:** Keep focus 100% on active study mastery.
* ❌ **DO NOT build complex multi-page dashboards:** Keep the UI single-page and phone-optimized.

---

## 13. Hackathon Team Role Allocation

```
┌─────────────────────────┬──────────────────────────────────────────────────┐
│ TEAM MEMBER ROLE        │ PRIMARY DELIVERABLES                             │
├─────────────────────────┼──────────────────────────────────────────────────┤
│ 1. Frontend Lead        │ • Mobile Student Mode UI                         │
│                         │ • Camera capture integration & canvas optimizer  │
│                         │ • Touch-friendly response rendering & chips      │
├─────────────────────────┼──────────────────────────────────────────────────┤
│ 2. Backend Lead         │ • Express API server & LAN network binding       │
│                         │ • Gemini 3.5 Flash streaming / interaction loops │
│                         │ • Terminal error handling & quota guardrails     │
├─────────────────────────┼──────────────────────────────────────────────────┤
│ 3. AI / RAG Engineer    │ • Document chunking & 768-D vector store         │
│                         │ • Controlled Learning Agent & deterministic tools│
│                         │ • Local AI intent classifier integration         │
├─────────────────────────┼──────────────────────────────────────────────────┤
│ 4. Mobile & QA Lead     │ • Physical phone testing on local Wi-Fi LAN      │
│                         │ • Camera focus, lighting, and latency checks     │
│                         │ • Edge-case failure recovery validation          │
├─────────────────────────┼──────────────────────────────────────────────────┤
│ 5. Pitch & Demo Lead    │ • Slide deck & live demo narrative               │
│                         │ • Curated physical props (textbooks, printouts)  │
│                         │ • Timekeeping & judge Q&A preparation            │
└─────────────────────────┴──────────────────────────────────────────────────┘
```

---

## 14. Zero-Day Rebuild & Final Test Checklist

Before walking up to the judges' table, run through this comprehensive checklist:

### Environment & Keys
- [ ] `.env` exists with valid `GEMINI_API_KEY`.
- [ ] `PORT=3001` configured and reachable.
- [ ] `LOCAL_AI_EXPERIMENT=true` set (or `false` for pure deterministic routing).

### Connectivity & Network
- [ ] Laptop and physical demo phone are connected to the **exact same Wi-Fi network**.
- [ ] Laptop IP verified via `ipconfig` (e.g., `192.168.0.123`).
- [ ] Phone successfully loads `http://<laptop-ip>:5173`.
- [ ] Reverse proxy verifies: `http://<laptop-ip>:5173/api/health` returns `HTTP 200 OK`.

### Core Functional Verification
- [ ] **Camera Test:** Tap 📷 on phone, snap photo of diagram, verify upload `<500KB`.
- [ ] **Multimodal Answer Test:** Verify explanation is generated with zero errors.
- [ ] **RAG Grounding Test:** Select a document (e.g., `dbms-normalization.pdf`), ask grounded question, verify source chips appear.
- [ ] **Agent Milestones Test:** Tap "Explain" or "Revise" chip, verify roadmap steps display.
- [ ] **Classroom Mode Test:** Run Classroom summary and assessment actions on a sample PDF.
- [ ] **No Infinite Loading:** Invalidate API key or trigger rate limit; verify UI terminates loading within 5s with a human-readable banner.
- [ ] **Clean Zero-State Reset:** "New Conversation" clears memory cleanly from `sessionStorage`.

---

**ByteMind AI Mentor** — *See. Ask. Learn.*  
*Ready for the Hackathon Stage.*
