// popup.js
class PopupManager {
  constructor() {
    this.settings = {};
    this.initialized = false;
    this.setupEventListeners();
    this.loadSettings();
    this.setupThemeListener();
  }

  async setupEventListeners() {
    // Save button
    document
      .getElementById("saveSettings")
      ?.addEventListener("click", () => this.saveSettings());

    // Reset button
    document.getElementById("resetSettings")?.addEventListener("click", () => {
      if (confirm("Are you sure you want to reset all settings to default?")) {
        this.resetSettings();
      }
    });

    // Theme handling
    document
      .getElementById("theme")
      ?.addEventListener("change", (e) =>
        this.handleThemeChange(e.target.value)
      );

    // Monitor all toggle inputs
    document.querySelectorAll(".toggle-input").forEach((toggle) => {
      toggle.addEventListener("change", () => this.handleSettingChange());
    });

    // Monitor all select inputs
    document.querySelectorAll(".select-input").forEach((select) => {
      select.addEventListener("change", () => this.handleSettingChange());
    });

    // Keyboard shortcuts
    document.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        this.saveSettings();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "r") {
        e.preventDefault();
        if (
          confirm("Are you sure you want to reset all settings to default?")
        ) {
          this.resetSettings();
        }
      }
    });
  }

  setupThemeListener() {
    // Listen for system theme changes
    window.matchMedia("(prefers-color-scheme: dark)").addListener(() => {
      if (this.settings?.appearance?.theme === "system") {
        this.applyTheme("system");
      }
    });
  }

  async loadSettings() {
    try {
      const result = await chrome.storage.sync.get("settings");
      this.settings = result.settings || this.getDefaultSettings();
      this.applySettings();
      this.initialized = true;
    } catch (error) {
      console.error("Failed to load settings:", error);
      this.showError("Failed to load settings");
    }
  }

  getDefaultSettings() {
    return {
      language: {
        default: "en",
        autoTranslate: true,
      },
      summary: {
        auto: true,
        showActionItems: true,
        length: "medium",
      },
      response: {
        suggest: true,
        style: "casual",
      },
      appearance: {
        theme: "system",
        compact: false,
      },
    };
  }

  applySettings() {
    if (!this.initialized) {
      // Set initial theme before other settings
      const theme = this.settings.appearance.theme || "system";
      this.applyTheme(theme);
    }

    // Language settings
    document.getElementById("defaultLanguage").value =
      this.settings.language.default;
    document.getElementById("autoTranslate").checked =
      this.settings.language.autoTranslate;

    // Summary settings
    document.getElementById("autoSummarize").checked =
      this.settings.summary.auto;
    document.getElementById("showActionItems").checked =
      this.settings.summary.showActionItems;
    document.getElementById("summaryLength").value =
      this.settings.summary.length;

    // Response settings
    document.getElementById("suggestResponses").checked =
      this.settings.response.suggest;
    document.getElementById("responseStyle").value =
      this.settings.response.style;

    // Appearance settings
    document.getElementById("theme").value = this.settings.appearance.theme;
    document.getElementById("compactMode").checked =
      this.settings.appearance.compact;
  }

  async saveSettings() {
    if (document.getElementById("saveSettings").disabled) {
      return;
    }

    const newSettings = {
      language: {
        default: document.getElementById("defaultLanguage").value,
        autoTranslate: document.getElementById("autoTranslate").checked,
      },
      summary: {
        auto: document.getElementById("autoSummarize").checked,
        showActionItems: document.getElementById("showActionItems").checked,
        length: document.getElementById("summaryLength").value,
      },
      response: {
        suggest: document.getElementById("suggestResponses").checked,
        style: document.getElementById("responseStyle").value,
      },
      appearance: {
        theme: document.getElementById("theme").value,
        compact: document.getElementById("compactMode").checked,
      },
    };

    try {
      // Disable save button while saving
      const saveButton = document.getElementById("saveSettings");
      saveButton.disabled = true;
      saveButton.textContent = "Saving...";

      // Save to storage
      await chrome.storage.sync.set({ settings: newSettings });
      this.settings = newSettings;

      // Update all Gmail tabs
      const tabs = await chrome.tabs.query({
        url: "*://mail.google.com/*",
      });

      // Send message to each tab
      const updatePromises = tabs.map((tab) => {
        return chrome.tabs
          .sendMessage(tab.id, {
            type: "SETTINGS_UPDATED",
            settings: newSettings,
          })
          .catch((error) => {
            console.log(`Failed to update tab ${tab.id}:`, error);
          });
      });

      // Wait for all messages to be sent
      await Promise.allSettled(updatePromises);

      this.showSaveConfirmation();
      this.handleSettingSaved();
    } catch (error) {
      console.error("Failed to save settings:", error);
      this.showError("Failed to save settings");
    } finally {
      // Re-enable save button
      const saveButton = document.getElementById("saveSettings");
      saveButton.disabled = false;
      saveButton.textContent = "Save Settings";
    }
  }

  async resetSettings() {
    try {
      const defaultSettings = this.getDefaultSettings();
      await chrome.storage.sync.set({ settings: defaultSettings });
      this.settings = defaultSettings;
      this.applySettings();
      this.showSaveConfirmation("Settings reset to default");

      // Update all Gmail tabs
      const tabs = await chrome.tabs.query({
        url: "*://mail.google.com/*",
      });

      const updatePromises = tabs.map((tab) => {
        return chrome.tabs
          .sendMessage(tab.id, {
            type: "SETTINGS_UPDATED",
            settings: defaultSettings,
          })
          .catch(console.error);
      });

      await Promise.allSettled(updatePromises);
    } catch (error) {
      console.error("Failed to reset settings:", error);
      this.showError("Failed to reset settings");
    }
  }

  handleThemeChange(theme) {
    this.applyTheme(theme);
    this.handleSettingChange();
  }

  applyTheme(theme) {
    if (theme === "system") {
      const prefersDark = window.matchMedia(
        "(prefers-color-scheme: dark)"
      ).matches;
      document.body.setAttribute("data-theme", prefersDark ? "dark" : "light");
    } else {
      document.body.setAttribute("data-theme", theme);
    }
  }

  handleSettingChange() {
    const saveButton = document.getElementById("saveSettings");
    saveButton.classList.add("unsaved");
    this.showUnsavedChangesWarning();
  }

  handleSettingSaved() {
    const saveButton = document.getElementById("saveSettings");
    saveButton.classList.remove("unsaved");
    const warning = document.querySelector(".unsaved-warning");
    if (warning) {
      warning.remove();
    }
  }

  showUnsavedChangesWarning() {
    const footer = document.querySelector(".settings-footer");
    let warning = footer.querySelector(".unsaved-warning");

    if (!warning) {
      warning = document.createElement("div");
      warning.className = "unsaved-warning";
      warning.textContent = "You have unsaved changes";
      footer.insertBefore(warning, footer.firstChild);
    }
  }

  showSaveConfirmation(message = "Settings saved successfully!") {
    const confirmation = document.getElementById("saveConfirmation");
    if (!confirmation) return;

    confirmation.textContent = message;
    confirmation.classList.remove("hidden");
    confirmation.classList.remove("fade-out");

    setTimeout(() => {
      confirmation.classList.add("fade-out");
      setTimeout(() => {
        confirmation.classList.add("hidden");
        confirmation.classList.remove("fade-out");
      }, 300);
    }, 2000);
  }

  showError(message) {
    const errorDiv = document.createElement("div");
    errorDiv.className = "error-message";
    errorDiv.textContent = message;

    const container = document.querySelector(".settings-container");
    if (container) {
      container.insertBefore(errorDiv, container.firstChild);

      setTimeout(() => {
        errorDiv.classList.add("fade-out");
        setTimeout(() => {
          errorDiv.remove();
        }, 300);
      }, 5000);
    }
  }
}

// Initialize popup
document.addEventListener("DOMContentLoaded", () => {
  const popup = new PopupManager();

  // Handle unsaved changes warning
  window.addEventListener("beforeunload", (e) => {
    const saveButton = document.getElementById("saveSettings");
    if (saveButton?.classList.contains("unsaved")) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
});
