# Yavar Shared Memory (RAG) Implementation Plan

## 🎯 Objective
Transform Yavar from a simple AI model wrapper into a **Cross-Model Orchestrator** by implementing a local-first Shared Memory system. This allows users to switch between ChatGPT, Claude, and Gemini while maintaining continuous context through Retrieval-Augmented Generation (RAG).

---

## 🏗️ Architecture Overview

1.  **Observer (Scraper):** `src/ai-bridge.js` uses `MutationObserver` to capture chat messages from AI iframes.
2.  **Vault (Storage):** **IndexedDB** acts as the persistent local database for all cross-model history.
3.  **Processor (Embeddings):** **Transformers.js (v3)** runs in a Chrome **Offscreen Document** using **WebGPU** to generate vector embeddings locally.
4.  **Retriever (Search):** **Orama** or **MiniSearch** provides hybrid (keyword + vector) search over the history.
5.  **Injector (RAG):** The extension automatically prepends relevant history snippets to new prompts when switching models.

---

## 🛠️ Phase 1: The "Observer" (Data Persistence)
**Goal:** Capture and store history locally.

- [ ] **Storage Layer:** Implement `src/utils/memoryManager.js` using IndexedDB.
- [ ] **Message Scraper:** Update `src/ai-bridge.js` to detect and scrape new user/assistant messages.
- [ ] **Background Sync:** Set up a message listener in `src/background.js` to receive scraped data and commit it to IndexedDB.
- [ ] **Basic History UI:** Add a "History" view in `sidepanel.js` to verify data is being saved.

## 🛠️ Phase 2: The "Retriever" (Hybrid Search)
**Goal:** Make the history searchable across models.

- [ ] **Search Engine:** Integrate **Orama** for lightweight client-side indexing.
- [ ] **Indexing Pipeline:** Automatically index new messages as they are saved to IndexedDB.
- [ ] **Search UI:** Add a search bar to the Yavar Side Panel to allow users to manually find past snippets.
- [ ] **Context Export:** Allow users to manually "pin" a past memory to the current session.

## 🛠️ Phase 3: The "Brain" (Context Injection & RAG)
**Goal:** Automatic context-aware model switching.

- [ ] **Offscreen Document:** Create `src/offscreen.html` and `src/offscreen.js` to handle heavy compute tasks.
- [ ] **Local Embeddings:** Implement **Transformers.js** with WebGPU to generate vectors for every stored message.
- [ ] **Semantic Retrieval:** When a user sends a prompt, automatically find the top-3 most relevant past interactions.
- [ ] **Prompt Augmentation:** Automatically wrap prompts with a `<shared_memory>` block containing retrieved context.
- [ ] **Summarization (Optional):** Use the built-in **Chrome Summarizer API** to condense long histories before injection.

---

## 🛡️ Security & Privacy
- **100% Local:** No chat data ever leaves the user's browser.
- **No Cloud Dependencies:** Embeddings and search run entirely on the user's CPU/GPU.
- **Clearance:** Users can clear their shared memory at any time from the Options page.

---

## 🚀 Next Steps
1.  **Initialize Phase 1:** Create `src/utils/memoryManager.js` and set up the IndexedDB schema.
2.  **Enhance AI Bridge:** Update the selectors in `ai-bridge.js` to handle the 2026 UI structures of ChatGPT and Claude.
s