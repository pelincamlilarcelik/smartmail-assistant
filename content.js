(() => {
  class EmailProcessor {
    constructor() {
      this.sidebar = null;
      this.processedEmails = new Set();
      this.isProcessing = false;
      this.setupUI();
      this.setupObserver();
      this.setupEventListeners();
      console.log("EmailProcessor initialized");
    }

    setupUI() {
      // Remove existing sidebar if any
      const existingSidebar = document.querySelector(".mailminds-sidebar");
      if (existingSidebar) {
        existingSidebar.remove();
      }

      const sidebar = document.createElement("div");
      sidebar.className = "mailminds-sidebar";
      sidebar.innerHTML = `
                <div class="sidebar-header">
                    <h2>MailMinds AI</h2>
                    <button class="collapse-button" type="button">≡</button>
                </div>
                <div class="sidebar-content">
                    <section class="summary-section">
                        <h3>Email Summary</h3>
                        <div class="summary-content"></div>
                    </section>
                    <section class="action-items-section">
                        <h3>Action Items</h3>
                        <div class="action-items-content"></div>
                    </section>
                    <section class="response-section">
                        <h3>Suggested Responses</h3>
                        <div class="response-content"></div>
                    </section>
                </div>
            `;
      document.body.appendChild(sidebar);
      this.sidebar = sidebar;
    }

    setupEventListeners() {
      if (!this.sidebar) return;

      // Collapse button handler
      const collapseButton = this.sidebar.querySelector(".collapse-button");
      if (collapseButton) {
        collapseButton.addEventListener("click", (e) => {
          e.preventDefault();
          this.sidebar.classList.toggle("collapsed");
        });
      }

      // Global click handler for the sidebar
      this.sidebar.addEventListener("click", async (e) => {
        const target = e.target;

        // Handle response button clicks
        if (target.classList.contains("response-button")) {
          e.preventDefault();
          const response = target.getAttribute("data-response");
          if (response) {
            await this.handleResponseClick(response);
          }
        }

        // Handle retry button clicks
        if (target.classList.contains("retry-button")) {
          e.preventDefault();
          await this.retryProcessing();
        }

        // Handle action item checkboxes
        if (target.classList.contains("action-checkbox")) {
          this.handleActionItemToggle(target);
        }
      });

      // Listen for Gmail navigation events
      window.addEventListener("hashchange", () => {
        this.handleGmailNavigation();
      });
    }

    setupObserver() {
      const observer = new MutationObserver((mutations) => {
        if (this.isProcessing) return;

        for (const mutation of mutations) {
          const emailContent = document.querySelector(
            ".a3s.aiL:not([data-processed])"
          );
          if (
            emailContent &&
            !this.processedEmails.has(emailContent.textContent)
          ) {
            this.processEmail(emailContent);
            break;
          }
        }
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["class"],
      });
    }

    async handleGmailNavigation() {
      // Clear processed emails when navigating away from an email
      if (!window.location.hash.includes("#inbox/")) {
        this.processedEmails.clear();
      }

      // Reset UI
      this.resetUI();

      // Process new email if present
      const emailContent = document.querySelector(".a3s.aiL");
      if (emailContent) {
        await this.processEmail(emailContent);
      }
    }

    resetUI() {
      if (!this.sidebar) return;

      const sections = [
        ".summary-content",
        ".action-items-content",
        ".response-content",
      ];
      sections.forEach((selector) => {
        const element = this.sidebar.querySelector(selector);
        if (element) {
          element.innerHTML = "";
        }
      });
    }

    async processEmail(emailElement) {
      if (!emailElement || this.isProcessing) return;

      const emailContent = this.getEmailContent(emailElement);
      if (!emailContent || this.processedEmails.has(emailContent)) return;

      this.isProcessing = true;
      this.showLoadingState();

      try {
        const [summary, actionItems, responses] = await Promise.all([
          this.sendMessage({
            type: "SUMMARIZE",
            content: emailContent,
          }),
          this.sendMessage({
            type: "EXTRACT_ACTION_ITEMS",
            content: emailContent,
          }),
          this.sendMessage({
            type: "GENERATE_RESPONSES",
            content: emailContent,
          }),
        ]);

        this.processedEmails.add(emailContent);
        emailElement.setAttribute("data-processed", "true");

        this.updateUI(summary?.data, actionItems?.data, responses?.data);
      } catch (error) {
        console.error("Email processing error:", error);
        this.showError(error.message);
      } finally {
        this.isProcessing = false;
      }
    }

    async retryProcessing() {
      const emailContent = document.querySelector(".a3s.aiL");
      if (emailContent) {
        emailContent.removeAttribute("data-processed");
        this.processedEmails.clear();
        await this.processEmail(emailContent);
      }
    }

    getEmailContent(emailElement) {
      if (!emailElement) return null;

      const subject = document.querySelector(".hP")?.textContent || "";
      const content = emailElement.textContent || "";

      return `Subject: ${subject}\n\n${content}`.trim();
    }

    async sendMessage(message) {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Request timed out"));
        }, 30000);

        try {
          chrome.runtime.sendMessage(message, (response) => {
            clearTimeout(timeout);

            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
              return;
            }

            if (response?.success) {
              resolve(response);
            } else {
              reject(new Error(response?.error || "Unknown error"));
            }
          });
        } catch (error) {
          clearTimeout(timeout);
          reject(error);
        }
      });
    }

    updateUI(summary, actionItems = [], responses = []) {
      if (!this.sidebar) return;

      // Update summary
      const summaryContent = this.sidebar.querySelector(".summary-content");
      if (summaryContent) {
        summaryContent.innerHTML = summary
          ? `<div class="summary-text">${summary}</div>`
          : `<div class="error">
                        <span>Could not generate summary</span>
                        <button type="button" class="retry-button">Retry</button>
                     </div>`;
      }

      // Update action items
      const actionItemsContent = this.sidebar.querySelector(
        ".action-items-content"
      );
      if (actionItemsContent) {
        if (Array.isArray(actionItems) && actionItems.length > 0) {
          const itemsHtml = actionItems
            .map((item) => {
              const id = this.generateUniqueId();
              return `
                            <div class="action-item">
                                <input type="checkbox" id="${id}" class="action-checkbox">
                                <label for="${id}">${this.escapeHtml(
                item.text
              )}</label>
                                ${
                                  item.deadline
                                    ? `
                                    <span class="deadline">Due: ${new Date(
                                      item.deadline
                                    ).toLocaleDateString()}</span>
                                `
                                    : ""
                                }
                            </div>
                        `;
            })
            .join("");
          actionItemsContent.innerHTML = itemsHtml;
        } else {
          actionItemsContent.innerHTML = "<p>No action items found</p>";
        }
      }

      // Update responses
      const responseContent = this.sidebar.querySelector(".response-content");
      if (responseContent) {
        if (Array.isArray(responses) && responses.length > 0) {
          const responsesHtml = responses
            .map(
              (response, index) => `
                        <button type="button" 
                                class="response-button" 
                                data-response="${this.escapeHtml(response)}">
                            Response ${index + 1}
                        </button>
                    `
            )
            .join("");
          responseContent.innerHTML = responsesHtml;
        } else {
          responseContent.innerHTML =
            "<p>No response suggestions available</p>";
        }
      }
    }

    async handleResponseClick(responseText) {
      if (!responseText) return;

      const composeButton = document.querySelector('[role="button"][gh="cm"]');
      if (composeButton) {
        composeButton.click();
        await new Promise((resolve) => setTimeout(resolve, 500));

        const composeBody = document.querySelector(
          '[role="textbox"][g_editable="true"]'
        );
        if (composeBody) {
          composeBody.innerHTML = responseText;
        }
      }
    }

    handleActionItemToggle(checkbox) {
      if (!checkbox) return;

      // Save action item state
      const actionItemId = checkbox.id;
      const isChecked = checkbox.checked;
      chrome.storage.local.get(["actionItems"], (result) => {
        const actionItems = result.actionItems || {};
        actionItems[actionItemId] = isChecked;
        chrome.storage.local.set({ actionItems });
      });

      // Update UI
      const actionItem = checkbox.closest(".action-item");
      if (actionItem) {
        actionItem.classList.toggle("completed", isChecked);
      }
    }

    showLoadingState() {
      if (!this.sidebar) return;

      const loadingHtml = `
                <div class="loading">
                    <div class="spinner"></div>
                    <span>Processing...</span>
                </div>
            `;

      ["summary-content", "action-items-content", "response-content"].forEach(
        (className) => {
          const element = this.sidebar.querySelector(`.${className}`);
          if (element) {
            element.innerHTML = loadingHtml;
          }
        }
      );
    }

    showError(message) {
      if (!this.sidebar) return;

      const errorHtml = `
                <div class="error">
                    <span>${this.escapeHtml(message)}</span>
                    <button type="button" class="retry-button">Retry</button>
                </div>
            `;

      ["summary-content", "action-items-content", "response-content"].forEach(
        (className) => {
          const element = this.sidebar.querySelector(`.${className}`);
          if (element) {
            element.innerHTML = errorHtml;
          }
        }
      );
    }

    generateUniqueId() {
      return `id-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    escapeHtml(text) {
      if (!text) return "";
      const div = document.createElement("div");
      div.textContent = text;
      return div.innerHTML;
    }
  }

  // Initialize the processor
  new EmailProcessor();
})();
