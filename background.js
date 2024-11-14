// background.js

// Global initialization tracking
let initializationPromise = null;
let processor = null;

async function getProcessor() {
  if (!processor) {
    processor = new AIProcessor();
  }
  if (!initializationPromise) {
    initializationPromise = processor.initializeModels();
  }
  try {
    await initializationPromise;
    return processor;
  } catch (error) {
    console.error("Processor initialization failed:", error);
    initializationPromise = null;
    throw error;
  }
}

class AIProcessor {
  constructor() {
    this.models = {
      summarizer: null,
      writer: null,
    };
    this.initialized = false;
    this.timeoutDuration = 60000; // 60 seconds
    this.operationTimeouts = {
      summarize: 30000,
      extract: 30000,
      generate: 30000,
    };
    this.maxRetries = 3;
    this.retryDelays = [1000, 2000, 4000]; // Exponential backoff
  }

  async initializeModels() {
    try {
      console.log("Starting AI model initialization...");

      // Initialize Summarizer
      console.log("Initializing summarizer...");
      this.models.summarizer = await this.withTimeout(
        ai.summarizer.create({
          type: "key-points",
          format: "plain-text",
        }),
        30000,
        "Summarizer initialization"
      );
      console.log("Summarizer initialized successfully");

      // Initialize Writer
      console.log("Initializing writer...");
      this.models.writer = await this.withTimeout(
        ai.writer.create(),
        30000,
        "Writer initialization"
      );
      console.log("Writer initialized successfully");

      this.initialized = true;
      console.log("All AI models initialized successfully");
      return true;
    } catch (error) {
      console.error("AI initialization error:", error);
      this.initialized = false;
      throw error;
    }
  }

  async withTimeout(promise, timeoutMs, operationName) {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`${operationName} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      promise
        .then((result) => {
          clearTimeout(timeoutId);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timeoutId);
          reject(error);
        });
    });
  }

  async withRetry(operation, maxRetries = this.maxRetries) {
    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`Attempt ${attempt}/${maxRetries} for operation`);
        return await operation();
      } catch (error) {
        console.error(`Attempt ${attempt} failed:`, error);
        lastError = error;

        if (attempt < maxRetries) {
          const delay = this.retryDelays[attempt - 1] || 5000;
          console.log(`Waiting ${delay}ms before retry...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError;
  }

  async handleMessage(request) {
    console.log("Processing request:", request.type);

    try {
      let result;
      switch (request.type) {
        case "SUMMARIZE":
          result = await this.withRetry(() =>
            this.summarizeText(request.content)
          );
          break;

        case "EXTRACT_ACTION_ITEMS":
          result = await this.withRetry(() =>
            this.extractActionItems(request.content)
          );
          break;

        case "GENERATE_RESPONSES":
          result = await this.withRetry(() =>
            this.generateResponses(request.content)
          );
          break;

        default:
          throw new Error(`Unknown request type: ${request.type}`);
      }

      return {
        success: true,
        data: result,
      };
    } catch (error) {
      console.error("Processing error:", error);
      return {
        success: false,
        error: error.message,
        needsReinitialization:
          error instanceof DOMException || error.message.includes("timed out"),
      };
    }
  }
  async summarizeText(text) {
    if (!this.models.summarizer) {
      throw new Error("Summarizer not initialized");
    }

    return new Promise(async (resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error("Summarization timed out"));
      }, this.operationTimeouts.summarize);

      try {
        const cleanText = this.sanitizeText(text);
        if (!cleanText) {
          throw new Error("No valid text to summarize");
        }

        if (cleanText.length > 1000) {
          const result = await this.processLongText(cleanText);
          clearTimeout(timeoutId);
          resolve(result);
        } else {
          const summary = await this.models.summarizer.summarize(cleanText);
          clearTimeout(timeoutId);
          resolve(this.formatSummary(summary));
        }
      } catch (error) {
        clearTimeout(timeoutId);
        reject(error);
      }
    });
  }

  async processLongText(text) {
    const chunks = this.splitIntoChunks(text, 1000);
    const summaries = [];

    for (const [index, chunk] of chunks.entries()) {
      try {
        console.log(`Processing chunk ${index + 1}/${chunks.length}`);
        const summary = await this.withTimeout(
          this.models.summarizer.summarize(chunk),
          this.operationTimeouts.summarize,
          `Chunk ${index + 1} summarization`
        );
        summaries.push(summary);
      } catch (error) {
        console.error(`Error processing chunk ${index + 1}:`, error);
      }
    }

    if (summaries.length === 0) {
      throw new Error("Failed to process any text chunks");
    }

    if (summaries.length > 1) {
      const combinedText = summaries.join(" ");
      const finalSummary = await this.models.summarizer.summarize(combinedText);
      return this.formatSummary(finalSummary);
    }

    return this.formatSummary(summaries[0]);
  }

  async extractActionItems(text) {
    if (!this.models.writer) {
      throw new Error("Writer not initialized");
    }

    return new Promise(async (resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error("Action item extraction timed out"));
      }, this.operationTimeouts.extract);

      try {
        const cleanText = this.sanitizeText(text);
        if (!cleanText) {
          throw new Error("No valid text to process");
        }

        const prompt = `
          Extract action items and deadlines from the following text.
          Format each task as:
          - Task: [action]
          - Deadline: [date if mentioned]

          Text:
          ${cleanText}
        `;

        const response = await this.models.writer.write(prompt);
        clearTimeout(timeoutId);
        resolve(this.parseActionItems(response));
      } catch (error) {
        clearTimeout(timeoutId);
        reject(error);
      }
    });
  }

  async generateResponses(text) {
    if (!this.models.writer) {
      throw new Error("Writer not initialized");
    }

    return new Promise(async (resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error("Response generation timed out"));
      }, this.operationTimeouts.generate);

      try {
        const cleanText = this.sanitizeText(text);
        if (!cleanText) {
          throw new Error("No valid text to process");
        }

        const prompt = `
          Generate three appropriate email responses to the following:
          
          Email:
          ${cleanText}
          
          Requirements:
          1. Brief and professional (2-3 sentences)
          2. Friendly and detailed (4-5 sentences)
          3. Formal and comprehensive (5-6 sentences)
          
          Format: Number each response clearly.
        `;

        const response = await this.models.writer.write(prompt);
        clearTimeout(timeoutId);
        resolve(this.parseResponses(response));
      } catch (error) {
        clearTimeout(timeoutId);
        reject(error);
      }
    });
  }

  splitIntoChunks(text, maxLength) {
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
    const chunks = [];
    let currentChunk = "";

    for (const sentence of sentences) {
      if ((currentChunk + sentence).length > maxLength) {
        if (currentChunk) chunks.push(currentChunk.trim());
        currentChunk = sentence;
      } else {
        currentChunk += sentence;
      }
    }

    if (currentChunk) chunks.push(currentChunk.trim());
    return chunks;
  }

  parseActionItems(text) {
    const items = [];
    const lines = text.split("\n");
    let currentItem = null;

    for (const line of lines) {
      const trimmedLine = line.trim();

      if (trimmedLine.startsWith("- Task:")) {
        if (currentItem && currentItem.text) {
          items.push(currentItem);
        }
        currentItem = {
          id: `task-${items.length + 1}`,
          text: trimmedLine.replace("- Task:", "").trim(),
          deadline: null,
        };
      } else if (trimmedLine.startsWith("- Deadline:") && currentItem) {
        const dateStr = trimmedLine.replace("- Deadline:", "").trim();
        if (dateStr && dateStr.toLowerCase() !== "none") {
          try {
            currentItem.deadline = new Date(dateStr);
            if (isNaN(currentItem.deadline.getTime())) {
              currentItem.deadline = null;
            }
          } catch (e) {
            console.error("Date parsing error:", e);
            currentItem.deadline = null;
          }
        }
      }
    }

    if (currentItem && currentItem.text) {
      items.push(currentItem);
    }

    return items;
  }

  parseResponses(text) {
    const responses = text
      .split(/\d+\.\s+/)
      .map((response) => response.trim())
      .filter((response) => response.length > 0)
      .map((response) => this.cleanResponse(response));

    // Ensure we have exactly 3 responses
    const defaultResponse =
      "Thank you for your email. I will review and respond accordingly.";
    while (responses.length < 3) {
      responses.push(defaultResponse);
    }

    return responses.slice(0, 3).map((response) => {
      response = response.trim();
      if (!response.match(/[.!?]$/)) {
        response += ".";
      }
      return response;
    });
  }

  cleanResponse(response) {
    return response
      .replace(/^["\s]+|["\s]+$/g, "") // Remove quotes and extra spaces
      .replace(/\n+/g, " ") // Replace newlines with spaces
      .replace(/\s{2,}/g, " ") // Replace multiple spaces with single space
      .trim();
  }

  sanitizeText(text) {
    if (!text) return "";

    return text
      .replace(/\s+/g, " ") // Replace multiple spaces with single space
      .replace(/[\r\n]+/g, "\n") // Normalize newlines
      .replace(/[^\w\s.,!?-]/g, "") // Remove special characters
      .trim();
  }

  formatSummary(summary) {
    if (!summary) return "";

    const points = summary
      .split(/[.!?]+/)
      .map((point) => point.trim())
      .filter((point) => point.length > 0)
      .map((point) => (point.startsWith("•") ? point : `• ${point}`));

    return points.join("\n");
  }
}

// Set up message handling
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("Received message:", request);
  const startTime = Date.now();

  // Handle the message
  getProcessor()
    .then((processor) => processor.handleMessage(request))
    .then((response) => {
      const duration = Date.now() - startTime;
      console.log(`Operation completed in ${duration}ms:`, response);
      sendResponse(response);
    })
    .catch((error) => {
      const duration = Date.now() - startTime;
      console.error(`Operation failed after ${duration}ms:`, error);
      sendResponse({
        success: false,
        error: error.message,
        needsReinitialization: true,
      });
    });

  return true; // Keep the message channel open
});

// Handle installation/update
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log("Extension installed/updated:", details.reason);
  initializationPromise = null; // Reset initialization
  try {
    await getProcessor();
    console.log("Installation/update initialization completed");
  } catch (error) {
    console.error("Failed to initialize after installation:", error);
  }
});

// Handle startup
chrome.runtime.onStartup.addListener(async () => {
  console.log("Extension starting up");
  initializationPromise = null; // Reset initialization
  try {
    await getProcessor();
    console.log("Startup initialization completed");
  } catch (error) {
    console.error("Failed to initialize on startup:", error);
  }
});
