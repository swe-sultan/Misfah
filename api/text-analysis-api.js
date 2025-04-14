/**
 * Misfah Text Analysis API
 * Integration with Claude 3.7 Haiku API for text classification through background script
 */

// Setup namespace to avoid globals
window.textAnalysisAPI = (function() {
  // API key (to be set from storage or popup)
  let apiKey = "blablabla";
  
  // Default batch size for API calls
  const DEFAULT_BATCH_SIZE = 50;
  
  // Regular expression for Arabic diacritical marks (harakat)
  const HARAKAT_PATTERN = /[\u064B-\u065F\u0670]/g;
  
  // Define the whitelist of Quranic phrases
  // This is a small sample - the full list should be loaded from a JSON file
  const WHITE_LIST = [
    "آبآؤكم وأبناؤكم لا تدرون أيهم",
    "آتاكم والله لا يحب كل",
    // Add more phrases here or load from a file
  ];
  
  // Normalize the whitelist for more efficient comparison
  const NORMALIZED_WHITE_LIST = WHITE_LIST.map(normalizeArabic);

  // Define safe categories - these will not be hidden
  const SAFE_CATEGORIES = [
    "safe",
    "Text from Quran",
    "Quran text", // Alternative naming
    "Islam",
    "economy",
    "science"
  ];
  
  /**
   * Normalize Arabic text by removing diacritical marks (harakat)
   * @param {string} text - Arabic text with potential harakat
   * @returns {string} Normalized text without harakat
   */
  function normalizeArabic(text) {
    if (!text || typeof text !== 'string') return '';
    return text.replace(HARAKAT_PATTERN, '');
  }
  
  /**
   * Check if text contains any phrases from the Quran whitelist
   * Uses harakat-insensitive comparison with precise matching
   * @param {string} text - The text to check
   * @returns {boolean} True if the text contains any whitelisted phrase
   */
  function textContainsWhitelistPhrase(text) {
    // Normalize the input text
    const normalizedText = normalizeArabic(text);
    
    // Split text into words for more precise matching
    const textWords = normalizedText.split(/\s+/);
    
    // For very short texts, require exact matching
    if (textWords.length <= 3) {
      return NORMALIZED_WHITE_LIST.includes(normalizedText);
    }
    
    // Check each pattern in the whitelist
    for (const pattern of NORMALIZED_WHITE_LIST) {
      // Split pattern into words
      const patternWords = pattern.split(/\s+/);
      
      // Skip very short patterns that might cause false positives
      if (patternWords.length < 2) {
        continue;
      }
      
      // Only count as match if the entire pattern is present
      if (normalizedText.includes(pattern)) {
        // Additional validation: at least half of pattern words must be found as whole words
        const wholeWordMatches = patternWords.reduce((count, word) => {
          return count + (new RegExp(`\\s${word}\\s`).test(` ${normalizedText} `) ? 1 : 0);
        }, 0);
        
        if (wholeWordMatches >= Math.floor(patternWords.length / 2)) {
          return true;
        }
      }
    }
    
    return false;
  }
  
  /**
   * Check if a category is considered safe (content should not be hidden)
   * @param {string} category - The category to check
   * @returns {boolean} True if the category is considered safe
   */
  function isSafeCategory(category) {
    return SAFE_CATEGORIES.includes(category);
  }
  
  /**
   * Apply whitelist protection to ensure Quranic content is properly categorized
   * @param {Array<string>} texts - List of original texts
   * @param {Array<string>} apiCategories - List of categories from the API
   * @returns {Array} [finalCategories, overrides] - Categories after protection & whether each was upgraded
   */
  function applyWhitelistProtection(texts, apiCategories) {
    if (texts.length !== apiCategories.length) {
      throw new Error("Number of texts and categories must match");
    }
    
    // Make a new copy of the categories to avoid modifying the original
    const finalCategories = [...apiCategories];
    const overrides = new Array(texts.length).fill(false);
    
    texts.forEach((text, i) => {
      // ONLY apply whitelist protection if:
      // 1. Text contains a whitelisted phrase
      // 2. AND category is not already "Quran text" or "safe"
      if (textContainsWhitelistPhrase(text) && 
          !["Quran text", "Text from Quran", "safe"].includes(apiCategories[i])) {
        finalCategories[i] = "Quran text";
        overrides[i] = true;
        console.log("[TextAnalysisAPI] Whitelist protection applied to text:", text.substring(0, 50) + "...");
      }
    });
    
    return [finalCategories, overrides];
  }
  
  /**
   * Main function that classifies texts with whitelist protection
   * First gets API classification through background script, then applies whitelist protection
   * @param {Array<string>} texts - List of texts to classify
   * @param {number} batchSize - Maximum batch size for API calls
   * @returns {Promise<Object>} Final categories after classification and protection
   */
  async function classifyContent(texts, batchSize = DEFAULT_BATCH_SIZE) {
    if (!texts || !texts.length) return { finalResults: [] };
    
    const allFinalResults = [];
    const allApiResults = [];
    const allOverrides = [];
    
    // Process in batches
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      console.log(`[TextAnalysisAPI] Processing batch ${i/batchSize + 1}, size: ${batch.length}`);
      
      try {
        // Send to background script for API classification
        const apiResults = await new Promise((resolve, reject) => {
          chrome.runtime.sendMessage(
            { 
              action: "claudeAnalyzeTexts", 
              texts: batch,
              apiKey: apiKey 
            },
            (response) => {
              if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
              }
              
              if (response && response.success) {
                resolve(response.results);
              } else {
                reject(new Error(response?.error || "Unknown error in API classification"));
              }
            }
          );
        });
        
        // Then apply whitelist protection
        const [finalResults, overrides] = applyWhitelistProtection(batch, apiResults);
        
        // Validate no downgrades occurred
        apiResults.forEach((apiCat, j) => {
          if ((apiCat === "Quran text" || apiCat === "Text from Quran") && 
              finalResults[j] !== "Quran text" && finalResults[j] !== "Text from Quran") {
            console.error(`[TextAnalysisAPI] CRITICAL ERROR: Text was improperly downgraded from 'Quran text' to '${finalResults[j]}'`);
          }
        });
        
        allApiResults.push(...apiResults);
        allFinalResults.push(...finalResults);
        allOverrides.push(...overrides);
      } catch (error) {
        console.error(`[TextAnalysisAPI] Error processing batch: ${error.message}`);
        
        // Fill with 'safe' for this batch on error
        const safeResults = new Array(batch.length).fill('safe');
        allApiResults.push(...safeResults);
        allFinalResults.push(...safeResults);
        allOverrides.push(...new Array(batch.length).fill(false));
      }
    }
    
    return {
      apiResults: allApiResults,
      finalResults: allFinalResults,
      overrides: allOverrides,
      safeCategories: SAFE_CATEGORIES
    };
  }
  
  /**
   * Set the API key for Claude
   * @param {string} key - The API key to use
   */
  function setApiKey(key) {
    apiKey = key;
    console.log("[TextAnalysisAPI] API key set");
  }
  
  /**
   * Test the connection to the Claude API via background script
   * @returns {Promise<Object>} Connection test result
   */
  async function testConnection() {
    if (!apiKey) {
      return { success: false, error: "API key not set" };
    }
    
    try {
      // Test via background script
      return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
          { 
            action: "claudeTestConnection", 
            apiKey: apiKey 
          },
          (response) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
              return;
            }
            
            resolve(response);
          }
        );
      });
    } catch (error) {
      console.error("[TextAnalysisAPI] Connection test failed:", error);
      return { success: false, error: error.message };
    }
  }
  
  /**
   * Main function for analyzing texts (used by content script)
   * @param {Array<string>} texts - Texts to analyze
   * @returns {Promise<Array<string>>} Classifications for each text
   */
  async function analyzeTexts(texts) {
    try {
      console.log(`[TextAnalysisAPI] Analyzing ${texts.length} texts`);
      
      if (!apiKey) {
        await loadApiKey();
      }
      
      const result = await classifyContent(texts);
      return result.finalResults;
    } catch (error) {
      console.error("[TextAnalysisAPI] Analysis error:", error);
      return new Array(texts.length).fill('safe');
    }
  }
  
  /**
   * Check if a category should be filtered/hidden
   * @param {string} category - The category to check
   * @returns {boolean} True if the category should be hidden
   */
  function shouldFilterCategory(category) {
    return !isSafeCategory(category);
  }
  
  /**
   * Load API key from Chrome storage
   * @returns {Promise<string|null>} The loaded API key or null
   */
  async function loadApiKey() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(["apiKey"], (data) => {
        if (data.apiKey) {
          apiKey = data.apiKey;
          console.log("[TextAnalysisAPI] API key loaded from storage");
        } else {
          console.warn("[TextAnalysisAPI] No API key found in storage");
        }
        resolve(apiKey);
      });
    });
  }
  
  /**
   * Save API key to Chrome storage
   * @param {string} key - The API key to save
   * @returns {Promise<boolean>} Whether the save was successful
   */
  async function saveApiKey(key) {
    return new Promise((resolve) => {
      chrome.storage.sync.set({ apiKey: key }, () => {
        apiKey = key;
        console.log("[TextAnalysisAPI] API key saved to storage");
        resolve(true);
      });
    });
  }
  
  // Load API key on initialization
  loadApiKey();
  
  // Public API
  return {
    analyzeTexts,
    testConnection,
    setApiKey,
    saveApiKey,
    textContainsWhitelistPhrase,
    normalizeArabic,
    isSafeCategory,
    shouldFilterCategory,
    getSafeCategories: () => [...SAFE_CATEGORIES]
  };
})();

// Log initialization
console.log("[TextAnalysisAPI] Module loaded");