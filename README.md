# ByteMind AI Mentor

> **"See. Ask. Learn."**

ByteMind is a phone-first multimodal AI learning companion that lets students see what they are studying, ask naturally, and learn using their own study material.

- **Team:** ByteMind
- **Hackathon:** iQOO Hackathon 2026 — Hyderabad City Battle
- **Track:** Smart Education

---

## 🎯 Problem

Students encounter complex questions, mathematical formulas, architectural diagrams, handwritten notes, textbook pages, and classroom slides in their daily physical study routines. 

However, getting timely, contextual AI assistance typically creates friction:
- **High Friction Input:** Students must manually transcribe equations, describe diagrams in text, or re-type lengthy problem statements.
- **Context Detachment:** Generic AI chatbots lack access to the student's actual syllabus, textbook chapters, or teacher notes, frequently producing broad, ungrounded explanations or hallucinations that don't match the curriculum.
- **Workflow Overwhelm:** Autonomous agents often inundate students with unsolicited quizzes, flashcards, or exercises when the student simply needs a direct, clear explanation.

---

## 💡 Solution

ByteMind grounds multimodal AI directly into the student's immediate physical study environment through a seamless three-step loop:

1. **SEE 📷**  
   Use the phone camera or photo gallery to instantly capture handwritten notes, printed textbook questions, code snippets, or system diagrams.
2. **ASK 🎙️💬**  
   Formulate questions naturally through voice input or conversational text without tedious manual transcription.
3. **LEARN 🧠📚**  
   ByteMind interprets visual and conversational queries, retrieves grounded context from the student's uploaded study documents (RAG), and delivers precise, step-by-step educational explanations tailored to the material.

---

## ✨ Key Features

- **📷 Multimodal Camera-Based Learning:** Instant camera capture and photo upload for visual question answering on diagrams, slides, and handwritten notes.
- **🎙️ Voice Interaction:** Mobile speech-to-text allowing students to ask complex academic questions hands-free.
- **💬 Text-Based AI Mentoring:** Socratic pedagogical mentor persona structured for conceptual clarity and deep understanding.
- **📚 Grounded RAG over Study Material:** Ingests student course materials and textbooks (e.g., PDFs) to anchor every answer in verified reference content with citation previews.
- **🧠 Controlled Learning Agent:** Goal-directed agent workflow that detects student learning intents (e.g., explanation, revision checklist, formula sheet, practice set).
- **🔄 Multi-Turn Conversation Context:** Preserves interactive context across follow-up questions for iterative concept mastering.
- **📝 Targeted Educational Workflows:**
  - **Explain:** Clear, intuitive breakdowns with real-world analogies.
  - **Revision Plans:** High-yield revision roadmaps and formula checklists from student notes.
  - **Practice:** Practical problems calibrated to study material difficulty.
  - **Quiz:** Focused knowledge checks with immediate feedback.
  - *Note: ByteMind does not automatically generate quizzes, practice exercises, or study plans after every response. These workflows are triggered strictly by the student's explicit request.*
- **🏫 Classroom Assistant:** Teacher and course assistant view to summarize lectures, identify core syllabus topics, and generate structured assignments and assessments directly from course documents.
- **🤖 Local AI Experimentation:** Developer console and feasibility lab supporting local on-device / local-server models for zero-cost and privacy-preserving inference.
- **📱 Phone-First Responsive Interface:** Ergonomic mobile-first interface optimized for one-handed operation on mobile devices like iQOO phones.

---

## 🧠 How It Works

```text
Student
   ↓
Camera / Voice / Text
   ↓
ByteMind Mobile Frontend
   ↓
Learning Agent & Intent Router
   ↓
RAG / Student Study Context
   ↓
Configured AI Provider
   ↓
Grounded Learning Response
```

### Dual-Environment Architecture

ByteMind is engineered to run seamlessly across two production-tested environments:

1. **Local Development Environment (Ollama + Qwen3):**
   - **Generation & Agent:** `qwen3:4b` running via local Ollama.
   - **Vision:** Multimodal understanding via local vision models (`qwen3-vl:4b`).
   - **RAG Retrieval:** Dense vector embeddings generated locally via `qwen3-embedding:0.6b` with in-memory cosine similarity search.
   - **Privacy:** 100% private, offline-capable local AI execution.

2. **Public Cloud Deployment (Render + Groq):**
   - **Generation & Agent:** Ultra-fast, low-latency LLM inference powered by Groq API (`llama-3.3-70b-versatile`).
   - **Vision:** High-throughput multimodal visual analysis powered by Groq vision models.
   - **Document Retrieval:** Provider-independent lexical BM25 retrieval over document text chunks.
   - *Factual Note: Groq is utilized strictly for ultra-fast generation and vision inference; it is not an embedding provider. For the Groq deployment, robust BM25 lexical retrieval matches query keywords against extracted student study chunks before passing relevant context to Groq for generation.*

---

## 🏗️ Architecture

```text
iQOO Phone / Mobile Browser
    │
    ├── 📷 Camera Capture
    ├── 🎙️ Voice Speech Input
    └── 💬 Text Input
         │
         ▼
ByteMind Frontend (React + TypeScript + Vite)
         │  (Mobile-first UI, Audio/Vision capture, Dev Console)
         │
         ▼ [REST API Proxy]
Node.js / Express Backend (:3001)
         │
         ├── 🧠 Learning Agent (Intent detection, tool orchestrator)
         ├── 📚 RAG Engine (PDF text extraction, chunking, retrieval)
         ├── 📷 Vision Handler (Base64 optimization, multimodal payload)
         └── 🏫 Classroom Assistant (Lecture summaries, assignment generation)
         │
         ▼ [Configured Provider Adapter]
AI Provider Layer
    ├── 🖥️ Ollama (Local Development: Qwen3 generation + Qwen3 dense vector embeddings)
    └── ☁️ Groq (Public Deployment: Ultra-fast LLM generation + Lexical BM25 retrieval)
         │
         ▼
Grounded Learning Response (Citations, Markdown explanations, Step-by-step guidance)
```

---

## 🛠️ Technology Stack

| Layer | Technology | Description |
| :--- | :--- | :--- |
| **Frontend** | React 18, TypeScript, Vite | Mobile-first SPA with touch-friendly controls, camera hooks, and responsive dark theme |
| **Backend** | Node.js, Express | Modular REST API with streaming, multi-provider abstraction, and session management |
| **AI Providers** | Ollama (Local), Groq (Cloud) | Multi-provider architecture supporting Qwen3, Groq Llama 3.3, and multimodal vision models |
| **RAG & Search** | PDF-Parse, BM25 Lexical, Vector Engine | Dense cosine similarity retrieval (Local) and provider-independent BM25 keyword retrieval (Cloud) |
| **Styling** | Vanilla CSS3 | Custom token-driven design system with dark mode and zero runtime overhead |
| **Deployment** | GitHub, Render | Continuous deployment with automatic health probes and environment switching |

---

## 🤖 Learning Agent

ByteMind features an intentional, controlled learning agent that avoids hallucinating unneeded artifacts:

- **Explain:** Deconstructs complex technical concepts with intuitive mental models.
- **Summary:** Condenses dense syllabus material into concise takeaways.
- **Study Plan:** Outlines realistic milestones based on syllabus documents.
- **Revision Plan:** Formulates high-yield exam checklists and formula summaries from student notes.
- **Practice:** Generates relevant practice questions matched to student progress.
- **Quiz:** Interactive self-assessment checks with answers and reasoning.
- **Topic Identification:** Highlights critical core themes from newly introduced material.

> **Important Guarantee:**  
> ByteMind does not automatically generate quizzes, practice exercises or study plans after every response. These workflows are triggered by the student's explicit request.

---

## 🏫 Classroom Assistant

The Classroom Assistant view provides structured, curriculum-aligned academic workflows:

- **Summarize Lecture:** Distills lecture slides, transcripts, and reading material into clear learning outcomes.
- **Identify Core Topics:** Maps prerequisites, key definitions, and focal exam topics.
- **Create Assignment:** Produces hands-on homework exercises and lab challenges directly grounded in course documents.
- **Create Assessment:** Formulates balanced diagnostic questions to evaluate student comprehension.

*Scope Note: The Classroom Assistant reuses the verified study-document and RAG infrastructure. It does not perform attendance logging, timetable administration, or automated student grading.*

---

## 📱 Phone-First Experience

In real-world studying, students use their smartphones as their primary lens. ByteMind is specifically optimized for physical phone hardware such as the **iQOO** smartphone:

```text
Capture a textbook question with Camera
           ↓
Ask clarification naturally via Voice
           ↓
ByteMind retrieves syllabus context from uploaded notes
           ↓
Receive clear, grounded pedagogical explanation
           ↓
Optionally request: Revise • Practice • Quiz
```

- **Touch Ergonomics:** All interactive buttons exceed 44px touch targets with responsive thumb-friendly placement.
- **Viewport Containment:** Engineered to prevent horizontal overflow across all screen widths (including narrow 360px–412px mobile viewports).
- **Responsive Developer Console:** 2-column adaptive grid layout on mobile screens ensuring engineering endpoints remain accessible without layout breakage.

*(Future Exploration: Native Android on-device NPU acceleration and offline camera pipelines are planned for future hardware-specific iterations).*

---

## 🚀 Getting Started

### Prerequisites
- Node.js (v18 or higher)
- npm (v9 or higher)
- *(Optional for Local AI)*: [Ollama](https://ollama.com/) with `qwen3:4b` and `qwen3-embedding:0.6b`

### 1. Clone & Install

```bash
git clone https://github.com/Nagendra-avg-art/bytemind-ai-mentor-lab.git
cd bytemind-ai-mentor-lab
npm install
```

### 2. Configure Environment

Copy the example environment file:
```bash
cp .env.example .env
```

Set your chosen provider in `.env`:

**Option A — Cloud Deployment (Groq):**
```env
PORT=3001
AI_PROVIDER=groq
GROQ_API_KEY=your_groq_api_key_here
GROQ_CHAT_MODEL=llama-3.3-70b-versatile
```

**Option B — Local Development (Ollama):**
```env
PORT=3001
AI_PROVIDER=ollama
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_CHAT_MODEL=qwen3:4b
OLLAMA_EMBED_MODEL=qwen3-embedding:0.6b
```

### 3. Run Development Server

```bash
npm run dev
```

Both services will start concurrently:
- **Express Backend:** `http://localhost:3001`
- **Vite Frontend:** `http://localhost:5173`

Access ByteMind in your desktop or mobile browser at `http://localhost:5173`.

### 4. Build for Production

```bash
npm run build
npm start
```

---

## 👥 Team ByteMind

Built with ❤️ for the **iQOO Hackathon 2026 — Hyderabad City Battle**  
*Track: Smart Education*
