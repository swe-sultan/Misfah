// Add this with your other variables at the top of the file
const hiddenPostsData = {}; // Store post IDs and their categories
let manualProcessingEnabled = false; // Flag to control continuous processing mode

// At the very beginning of the file
console.log("🔴 Content script file started loading");

// Right before the window.misfah assignment 
console.log("🔵 About to create window.misfah object");

// Right after the window.misfah assignment
console.log("🟢 Created window.misfah object");

// At the DOMContentLoaded event
console.log("🟠 DOMContentLoaded fired");
// Improved content script with better error handling
console.log("[CONTENT] Content script loaded at", new Date().toISOString());
let initialBatchProcessed = false;
const INITIAL_BATCH_SIZE = 50; // Process only 50 tweets on initial load
let batchProcessingInProgress = false; // Flag to prevent multiple batches processing simultaneously
let processedBatchCount = 0; // Track how many batches we've processed
let lastBatchTime = 0; // Track when the last batch was processed

// Debug mode - set to true for detailed logging
const DEBUG_MODE = true;
// Track the results of text analysis
let twitterTextResults = {};
let threadsTextResults = {};
let pendingTextAnalysis = false;

// Define variables at the top level
let isEnabled = true; // Default filter state
let preferences = {
  polytheism: true,
  violence: true,
  gambling: true,
  alcohol: true,
  sexual: true
};

// Default keywords for each category
const categoryKeywords = {
  polytheism: ["polytheism", "shirk", "idolatry"],
  violence: ["violence", "aggression", "abuse"],
  gambling: ["gambling", "betting", "casino", "قرعة"],
  alcohol: ["alcohol", "drinks", "liquor"],
  sexual: ["sexual", "nude", "naked", "porn"]
};

// Define the safe categories - content in these categories should not be hidden
const SAFE_CATEGORIES = [
  "safe",
  "Text from Quran",
  "Quran text", // Alternative naming
  "Islam",
  "economy",
  "science"
];

// Helper function to check if a category is considered safe (should not be hidden)
function isSafeCategory(category) {
  return SAFE_CATEGORIES.includes(category);
}

// Function to determine if content should be hidden based on its category
function shouldHideContent(textCategory, userPreferences) {
  // If the text analysis API module is available, use its function
  if (window.textAnalysisAPI && typeof window.textAnalysisAPI.isSafeCategory === 'function') {
    return !window.textAnalysisAPI.isSafeCategory(textCategory);
  }
  
  // Fallback if the API module isn't available or function doesn't exist
  return !isSafeCategory(textCategory);
}

let twitterFilteredCount = 0;
let threadsFilteredCount = 0;
let processedPosts = new Set(); // Track already processed posts
let hiddenPosts = new Set(); // Track posts that have been hidden to avoid reprocessing
let lastAlertTime = 0; // Track the last time we showed an alert
let modelStatusChecks = 0;
const MAX_MODEL_STATUS_CHECKS = 90; // 90 checks = 90 seconds (with 1 second interval)

// Try creating the misfah object earlier in the file, right after variable declarations
window.misfah = {};
console.log("Created initial misfah object");

// Load hidden post data on startup
function loadHiddenPosts() {
  chrome.storage.local.get(['hiddenPostsData'], (result) => {
    if (result.hiddenPostsData && typeof result.hiddenPostsData === 'object') {
      // Copy data from storage to our local object
      Object.assign(hiddenPostsData, result.hiddenPostsData);
      console.log(`Loaded ${Object.keys(hiddenPostsData).length} hidden posts with categories from storage`);
    }
  });
}

// Save hidden posts to persistent storage
function persistHiddenPosts() {
  chrome.storage.local.set({
    hiddenPostsData: hiddenPostsData
  });
}


// Then populate it later
function setupDebugInterface() {
  console.log("Setting up debug interface");
  window.misfah.forceReprocess = forceReprocessAllContent;
  window.misfah.getStats = () => ({
    processedPosts: processedPosts.size,
    hiddenPosts: hiddenPosts.size,
    twitterResults: Object.keys(twitterTextResults).length,
    threadsResults: Object.keys(threadsTextResults).length,
    twitterFiltered: twitterFilteredCount,
    threadsFiltered: threadsFilteredCount
  });
  console.log("Debug interface set up successfully");
}

// Helper function for debugging
function debugLog(...args) {
  if (DEBUG_MODE) {
    console.log("[Sensitive Content Filter]", ...args);
  }
}

// ==========================================
// INITIALIZATION & HELPER FUNCTIONS
// ==========================================

// Helper function for throttled storage operations
function throttledStorageSave(data) {
  const now = Date.now();
  if (!window.lastStorageWriteTime || now - window.lastStorageWriteTime > 3000) {
    window.lastStorageWriteTime = now;
    chrome.storage.sync.set(data);
    debugLog("Storage updated:", data);
  } else {
    debugLog("Storage write throttled");
  }
}

// Add a debug function to force reprocessing of all content
function forceReprocessAllContent() {
  debugLog("Manual reprocessing of all content triggered");
  console.log("🔄 Misfah: Forcing reprocessing of all content");
  
  // Clear all tracking data
  processedPosts = new Set();
  hiddenPosts = new Set();
  twitterTextResults = {};
  threadsTextResults = {};
  
  // Remove processing markers from all posts
  const { twitterPosts, threadsPosts } = getPosts();
  
  Array.from(twitterPosts).forEach(post => {
    delete post.dataset.hasMisfahPlaceholder;
    delete post.dataset.misfahContentViewed;
    delete post.dataset.misfahProcessed;
  });
  
  Array.from(threadsPosts).forEach(post => {
    delete post.dataset.hasMisfahPlaceholder;
    delete post.dataset.misfahContentViewed;
    delete post.dataset.misfahProcessed;
  });
  
  // Run filtering 
  runFilterContent();
  
  return "Reprocessing triggered for " + 
         (twitterPosts.length + threadsPosts.length) + 
         " posts";
}

// Update the initializeExtension function to add the manual processing button
function initializeExtension() {
  debugLog("Initializing extension...");
  
  // Load saved hidden posts
  loadHiddenPosts();
  
  // Load preferences and filter state from storage
  chrome.storage.sync.get(["preferences", "isEnabled", "twitterFilteredCount", "threadsFilteredCount", "threshold"], (data) => {
    debugLog("Initial filtering starting");
    
    if (data.preferences) {
      preferences = data.preferences;
    }
    if (data.isEnabled !== undefined) {
      isEnabled = data.isEnabled;
    }
    
    twitterFilteredCount = data.twitterFilteredCount || 0;
    threadsFilteredCount = data.threadsFilteredCount || 0;

    debugLog("Initial preferences loaded:", preferences);
    debugLog("Initial filtering state loaded:", isEnabled);
    
    // Initialize text API
    initializeTextAPI();
    
    // Setup URL change monitoring to reset state on navigation
    setupURLChangeMonitoring();
    
    // Initialize filtering
    checkModelAndStartFiltering();
    
    // Add the manual processing button
    setTimeout(() => {
      addManualProcessingButton();
    }, 5000);
  });
  
  debugLog("✅ Initialization complete - filter enabled: " + isEnabled);
  
  // Force an initial processing run
  setTimeout(() => {
    debugLog("🔄 Forcing initial content scan");
    runFilterContent();
  }, 3000);
}





// ==========================================
// MODEL & API INITIALIZATION
// ==========================================

// Initialize text API
function initializeTextAPI() {
  if (!window.textAnalysisAPI) {
    console.error("TextAnalysisAPI not available");
    return false;
  }
  
  // Load API key from storage
  chrome.storage.sync.get(["apiKey"], (data) => {
    if (data.apiKey) {
      window.textAnalysisAPI.setApiKey(data.apiKey);
      console.log("API key loaded from storage");
      
      // Test connection
      window.textAnalysisAPI.testConnection()
        .then(result => {
          if (result.success) {
            console.log("Claude API connection successful");
          } else {
            console.warn("Claude API connection failed:", result.error);
          }
        })
        .catch(error => {
          console.error("Claude API test error:", error);
        });
    } else {
      console.warn("No Claude API key found in storage");
      // You might want to notify the user they need an API key
    }
  });
  
  return true;
}

// Modified setupMutationObserver function that handles new content better
function setupMutationObserver() {
  console.log("⚙️ Setting up mutation observer");
  debugLog("Setting up mutation observer");
  
  // Variables to track significant content changes
  let lastObserverRun = 0;
  let significantChangesCount = 0;
  let newPostsDetected = false;
  
  const throttledObserver = new MutationObserver((mutations) => {
    const now = Date.now();
    
    // First, check for posts that were hidden but are now visible again
    const currentPosts = getPosts();
    const allCurrentPosts = [...currentPosts.twitterPosts, ...currentPosts.threadsPosts];
    
    // Look for posts with IDs in our hiddenPostsData object
    for (const post of allCurrentPosts) {
      const postId = getPostId(post);
      
      // If this post should be hidden but isn't currently hidden
      if (hiddenPostsData[postId] && !post.dataset.hasMisfahPlaceholder) {
        // Skip if user manually showed this post
        if (post.dataset.misfahUserShown === "true") {
          continue;
        }
        
        // Get the saved categories from our data store
        const savedData = hiddenPostsData[postId];
        const categories = savedData.categories || ['sensitive'];
        
        // Re-create the placeholder with the correct categories
        createFilteredPostPlaceholder(post, categories, null);
        
        // Add to hiddenPosts set to prevent reprocessing
        hiddenPosts.add(post);
      }
    }
    
    // Count significant DOM changes
    const significantAdditions = mutations.reduce((count, mutation) => {
      return count + mutation.addedNodes.length;
    }, 0);
    
    // If we detect many new nodes (like new tweets being loaded)
    if (significantAdditions > 8) { // Slightly more sensitive threshold
      significantChangesCount++;
      console.log(`Detected ${significantAdditions} new nodes (count: ${significantChangesCount})`);
      
      // Mark that new posts were detected
      newPostsDetected = true;
      
      // Check if enough time has passed since the last run and no processing is happening
      if (now - lastObserverRun > 5000 && !batchProcessingInProgress) {
        lastObserverRun = now;
        
        // Check if we have any unprocessed posts
        const { twitterPosts, threadsPosts } = getPosts();
        const unprocessedPosts = [
          ...Array.from(twitterPosts).filter(post => !isPostProcessedByMisfah(post)),
          ...Array.from(threadsPosts).filter(post => !isPostProcessedByMisfah(post))
        ];
        
        if (unprocessedPosts.length > 10) {
          console.log(`Found ${unprocessedPosts.length} unprocessed posts after scrolling`);
          
          // Reset counter after triggering processing
          significantChangesCount = 0;
          newPostsDetected = false;
          
          // Only run if enabled
          if (isEnabled) {
            console.log("Triggering batch processing for newly detected posts");
            
            // Trigger with a slight delay to let the page stabilize
            setTimeout(() => {
              runFilterContent(true);
            }, 1500);
          }
        }
      }
    }
    
    // Even if we haven't seen enough changes yet, if we've accumulated changes and some time has passed,
    // check if we should process new content
    if (newPostsDetected && significantChangesCount >= 2 && now - lastObserverRun > 8000 && !batchProcessingInProgress) {
      lastObserverRun = now;
      
      // Check for unprocessed posts
      const { twitterPosts, threadsPosts } = getPosts();
      const unprocessedPosts = [
        ...Array.from(twitterPosts).filter(post => !isPostProcessedByMisfah(post)),
        ...Array.from(threadsPosts).filter(post => !isPostProcessedByMisfah(post))
      ];
      
      if (unprocessedPosts.length > 15) {
        console.log(`Found ${unprocessedPosts.length} unprocessed posts after accumulated changes`);
        
        // Reset counter after triggering processing
        significantChangesCount = 0;
        newPostsDetected = false;
        
        // Only run if enabled
        if (isEnabled) {
          console.log("Triggering batch processing for accumulated new posts");
          
          // Trigger with a slight delay
          setTimeout(() => {
            runFilterContent(true);
          }, 1500);
        }
      }
    }
  });

  // Start observing the document
  throttledObserver.observe(document.body, {
    childList: true,
    subtree: true,
  });

  // Clean up observer when extension is disabled/removed
  window.addEventListener("unload", () => {
    throttledObserver.disconnect();
  });
  
  debugLog("Mutation observer initialized");
}


// Add scroll tracking to detect when user is actively scrolling
let lastUserScrollTime = 0;
window.addEventListener('scroll', () => {
  lastUserScrollTime = Date.now();
}, { passive: true });

// Add a status display to show processing information
function addProcessingStatusDisplay() {
  // Check if status display already exists
  if (document.getElementById('misfah-status-display')) {
    return;
  }
  
  const statusContainer = document.createElement('div');
  statusContainer.id = 'misfah-status-display';
  statusContainer.style.position = 'fixed';
  statusContainer.style.bottom = '20px';
  statusContainer.style.right = '20px';
  statusContainer.style.zIndex = '10000';
  statusContainer.style.display = 'flex';
  statusContainer.style.flexDirection = 'column';
  statusContainer.style.gap = '10px';
  
  // Counter display element
  const counterDisplay = document.createElement('div');
  counterDisplay.id = 'misfah-counter';
  counterDisplay.textContent = 'تم تحليل: 0 منشور';
  counterDisplay.style.backgroundColor = 'rgba(79, 163, 247, 0.9)';
  counterDisplay.style.color = 'white';
  counterDisplay.style.borderRadius = '20px';
  counterDisplay.style.padding = '8px 12px';
  counterDisplay.style.textAlign = 'center';
  counterDisplay.style.fontSize = '14px';
  counterDisplay.style.fontFamily = 'IBM Plex Sans Arabic, Arial, sans-serif';
  counterDisplay.style.boxShadow = '0 2px 5px rgba(0,0,0,0.2)';
  
  // Button to manually process more
  const processButton = document.createElement('button');
  processButton.id = 'misfah-process-more';
  processButton.textContent = 'تحليل المزيد من المنشورات';
  processButton.style.backgroundColor = '#4fa3f7';
  processButton.style.color = 'white';
  processButton.style.border = 'none';
  processButton.style.borderRadius = '20px';
  processButton.style.padding = '8px 12px';
  processButton.style.cursor = 'pointer';
  processButton.style.fontWeight = 'bold';
  processButton.style.boxShadow = '0 2px 5px rgba(0,0,0,0.2)';
  processButton.style.fontFamily = 'IBM Plex Sans Arabic, Arial, sans-serif';
  
  processButton.addEventListener('click', () => {
    runFilterContent(true);
  });
  
  // Function to update the counter
  function updateProcessingCounter() {
    const stats = window.misfah.getStats();
    const totalProcessed = stats.processedPosts; 
    const totalFiltered = stats.twitterFiltered + stats.threadsFiltered;
    
    counterDisplay.textContent = `تم تحليل: ${totalProcessed} منشور | تم تصفية: ${totalFiltered} | ${processedBatchCount} دفعات`;
  }
  
  // Update counter initially
  updateProcessingCounter();
  
  // Set up timer to update counter
  setInterval(updateProcessingCounter, 5000);
  
  statusContainer.appendChild(counterDisplay);
  statusContainer.appendChild(processButton);
  document.body.appendChild(statusContainer);
}

// Modified to reset batch processing on URL changes
function setupURLChangeMonitoring() {
  let lastURL = window.location.href;
  
  // Check for URL changes periodically
  setInterval(() => {
    const currentURL = window.location.href;
    if (currentURL !== lastURL) {
      debugLog(`URL changed from ${lastURL} to ${currentURL}, resetting state`);
      console.log("URL changed, resetting Misfah state");
      
      // Reset all tracking
      processedPosts = new Set();
      hiddenPosts = new Set();
      twitterTextResults = {};
      threadsTextResults = {};
      
      // Reset the batch processing flags
      initialBatchProcessed = false;
      processedBatchCount = 0;
      batchProcessingInProgress = false;
      
      // Run filtering after a small delay to let the new page load
      setTimeout(() => {
        if (isEnabled) {
          runFilterContent();
        }
      }, 1000);
      
      lastURL = currentURL;
    }
  }, 1000);
  
  // Also monitor for Twitter's SPA navigation events that don't change the URL
  document.addEventListener('click', (event) => {
    // Check if clicked element is a navigation link
    const isNavigation = event.target.closest('a[href^="/"]') || 
                        event.target.closest('a[role="link"]') ||
                        event.target.closest('[data-testid="AppTabBar_Home_Link"]') ||
                        event.target.closest('[data-testid="AppTabBar_Explore_Link"]');
    
    if (isNavigation) {
      debugLog("Navigation click detected, scheduling state reset");
      
      // Reset all tracking after a slight delay to ensure navigation completes
      setTimeout(() => {
        processedPosts = new Set();
        hiddenPosts = new Set(); 
        twitterTextResults = {};
        threadsTextResults = {};
        
        // Reset the batch processing flags
        initialBatchProcessed = false;
        processedBatchCount = 0;
        batchProcessingInProgress = false;
        
        // Run filtering if enabled
        if (isEnabled) {
          runFilterContent();
        }
      }, 1500);
    }
  });
  
  debugLog("URL change monitoring initialized");
}



// Update the initializeExtension function to add the status display
function initializeExtension() {
  debugLog("Initializing extension...");
  
  // Load saved hidden posts
  loadHiddenPosts();
  
  // Load preferences and filter state from storage
  chrome.storage.sync.get(["preferences", "isEnabled", "twitterFilteredCount", "threadsFilteredCount", "threshold"], (data) => {
    debugLog("Initial filtering starting");
    
    if (data.preferences) {
      preferences = data.preferences;
    }
    if (data.isEnabled !== undefined) {
      isEnabled = data.isEnabled;
    }
    
    twitterFilteredCount = data.twitterFilteredCount || 0;
    threadsFilteredCount = data.threadsFilteredCount || 0;

    debugLog("Initial preferences loaded:", preferences);
    debugLog("Initial filtering state loaded:", isEnabled);
    
    // Initialize text API
    initializeTextAPI();
    
    // Setup URL change monitoring to reset state on navigation
    setupURLChangeMonitoring();
    
    // Initialize filtering
    checkModelAndStartFiltering();
    
    // Add the processing status display
    setTimeout(() => {
      addProcessingStatusDisplay();
    }, 5000);
  });
  
  debugLog("✅ Initialization complete - filter enabled: " + isEnabled);
  
  // Force an initial processing run
  setTimeout(() => {
    debugLog("🔄 Forcing initial content scan");
    runFilterContent();
  }, 3000);
}



// Improved model status checking with proper error handling
function checkModelAndStartFiltering() {
  debugLog("Checking model status with background script");
  
  const checkModelStatus = () => {
    
    // Increment check counter
    modelStatusChecks++;
    
    // Give up after too many checks
    if (modelStatusChecks > MAX_MODEL_STATUS_CHECKS) {
      debugLog("Model check timed out after too many attempts");
      createWebpageAlert("فشل تحميل نموذج تحليل الصور - حصل خطأ في التحميل", null, true);
      
      // Try to filter content anyway (text only)
      if (isEnabled) {
        runFilterContent();
        setupMutationObserver();
      }
      return;
    }
    
    chrome.runtime.sendMessage({ action: "getModelStatus" }, (response) => {
      console.log("📊 Model status check response:", response);
      if (chrome.runtime.lastError) {
        debugLog("Error checking model status:", chrome.runtime.lastError.message);
        setTimeout(checkModelStatus, 1000); // Check again in 1 second
        return;
      }
      
      if (response && response.isLoaded) {
        debugLog("Model is loaded in background script, starting content filtering");
        
        // Start filtering with the real model
        if (isEnabled) {
          runFilterContent();
          setupMutationObserver();
        }
      } else if (response && response.error) {
        debugLog("Model loading failed with error:", response.error);
        
        // Show error to user
        createWebpageAlert(`فشل تحميل نموذج تحليل الصور: ${response.error}`, null, true);
        
        // Try to filter content anyway (text only)
        if (isEnabled) {
          runFilterContent();
          setupMutationObserver();
        }
      } else {
        debugLog("Model not loaded yet in background, waiting...");
        
        // If model is currently loading, show progress
        if (response && response.isLoading && response.progress > 0) {
          debugLog(`Model loading progress: ${response.progress}%`);
        }
        
        setTimeout(checkModelStatus, 1000); // Check again in 1 second
      }
    });
  };
  
  // Start checking
  checkModelStatus();
}

// ==========================================
// POST DETECTION & FILTERING FUNCTIONS
// ==========================================

// Function to get posts based on the platform
function getPosts() {
  const twitterPosts = document.querySelectorAll('[data-testid="tweet"]');
  console.log("📝 Found Twitter posts:", twitterPosts.length);
  const currentURL = window.location.hostname;
  
  if (currentURL.includes('twitter.com') || currentURL.includes('x.com')) {
    // For Twitter/X
    return {
      twitterPosts: document.querySelectorAll('[data-testid="tweet"]'),
      threadsPosts: []
    };
  } else if (currentURL.includes('threads.net')) {
    // For Threads
    return {
      twitterPosts: [],
      threadsPosts: document.querySelectorAll("article")
    };
  }
  
  return { twitterPosts: [], threadsPosts: [] };
}

// Find images in a post using multiple selectors - with enhanced logging
function findImagesInPost(post) {
  const postId = getPostId(post); // Get unique ID for this post
  console.log(`[IMAGE FINDER] Searching for images in post ${postId}`);
  
  // Use multiple selectors to find images
  const imageSelectors = [
    'img[src*="media"]',                 // Traditional media
    'img[src*="pbs.twimg.com/media"]',   // Twitter media server
    'img[src*="twimg.com"]',             // Any Twitter image
    'article img',                       // Any image in an article
    '[data-testid="tweetPhoto"] img',    // Tweet photos
    'div[aria-label="Image"] img',       // Labeled images
    'div[data-testid="tweet"] img'       // Any image in tweet
  ];
  
  // Find all images using our comprehensive selectors
  const images = [];
  for (const selector of imageSelectors) {
    const found = post.querySelectorAll(selector);
    if (found.length > 0) {
      console.log(`[IMAGE FINDER] Found ${found.length} images using selector: ${selector}`);
    }
    
    found.forEach(img => {
      // Don't add duplicates or profile photos
      if (!images.includes(img) && 
          !(img.alt && img.alt.toLowerCase().includes("profile"))) {
        images.push(img);
      }
    });
  }
  
  // Filter out small images
  const validImages = images.filter(img => (img.width >= 100 && img.height >= 100));
  
  console.log(`[IMAGE FINDER] Post ${postId}: Found ${images.length} total images, ${validImages.length} valid for analysis`, 
              post.innerText ? "Text: " + post.innerText.substring(0, 30) + "..." : "[No text]");
  
  if (validImages.length > 0) {
    validImages.forEach((img, index) => {
      console.log(`[IMAGE FINDER] Valid image ${index + 1}/${validImages.length}: ${img.width}x${img.height}, src: ${img.src ? img.src.substring(0, 50) + "..." : "no src"}`);
    });
  }
  
  return validImages;
}


// Improved getPostId function that tries to extract the actual Twitter/Threads post ID
function getPostId(post) {
  // Try to get the actual Tweet ID from the post's attributes or links
  try {
    // Check for Twitter's data-tweet-id attribute
    const tweetIdAttr = post.getAttribute('data-tweet-id');
    if (tweetIdAttr) return 'twitter_' + tweetIdAttr;
    
    // Try to find it in permalink links
    const permalinkEl = post.querySelector('a[href*="/status/"]');
    if (permalinkEl) {
      const href = permalinkEl.getAttribute('href');
      const match = href.match(/\/status\/(\d+)/);
      if (match && match[1]) return 'twitter_' + match[1];
    }
    
    // For Threads, try to extract from the article's data attributes
    if (post.tagName === 'ARTICLE') {
      // Look for data attributes that might contain IDs
      for (const attr of post.getAttributeNames()) {
        if (attr.startsWith('data-') && post.getAttribute(attr).length > 10) {
          return 'threads_' + post.getAttribute(attr);
        }
      }
    }
  } catch (e) {
    console.error('Error getting post ID:', e);
  }
  
  // Fallback to using our generated ID if we couldn't find a real one
  if (!post._postId) {
    post._postId = 'post_' + Math.random().toString(36).substr(2, 9);
  }
  return post._postId;
}

// Helper function to check if a post has already been processed by Misfah
function isPostProcessedByMisfah(post) {
    // First, check if this post was explicitly shown by the user
    if (post.dataset.misfahUserShown === "true") {
      return true;
    }
  // Check if this post ID has been hidden before
  const postId = getPostId(post);
  if (hiddenPostsData[postId]) {
    // If the post is in hiddenPostsData but not currently marked with a placeholder,
    // we should re-hide it but return false so that happens
    if (!post.dataset.hasMisfahPlaceholder) {
      return false;
    }
    return true;
  }
  
  // Check hiddenPosts set to avoid reprocessing already hidden posts
  if (hiddenPosts.has(post)) {
    return true;
  }
  
  // Then check processedPosts Set
  if (processedPosts.has(post)) {
    return true;
  }
  
  // Only check dataset attributes as backup
  return post.dataset.hasMisfahPlaceholder === "true" || 
         post.dataset.misfahContentViewed === "true" ||
         post.dataset.misfahProcessed === "true";
}

// ==========================================
// TEXT ANALYSIS FUNCTIONS
// ==========================================

// Improved batch text analysis that combines API and keyword analysis
async function batchAnalyzePostsText() {
  if (pendingTextAnalysis) {
    debugLog("Text analysis already in progress, skipping");
    return;
  }
  
  pendingTextAnalysis = true;
  
  try {
    debugLog("Starting batch text analysis with Claude API and keywords");
    const { twitterPosts, threadsPosts } = getPosts();
    
    // Get unprocessed posts - improved to also check hiddenPosts set
    const unprocessedTwitterPosts = Array.from(twitterPosts).filter(post => 
      !isPostProcessedByMisfah(post) && !hiddenPosts.has(post)
    );
    const unprocessedThreadsPosts = Array.from(threadsPosts).filter(post => 
      !isPostProcessedByMisfah(post) && !hiddenPosts.has(post)
    );
    
    debugLog(`Found ${unprocessedTwitterPosts.length} unprocessed Twitter posts and ${unprocessedThreadsPosts.length} unprocessed Threads posts`);
    console.log(`Running batch text analysis: ${unprocessedTwitterPosts.length} Twitter posts, ${unprocessedThreadsPosts.length} Threads posts`);
    
    // Process Twitter posts first
    if (unprocessedTwitterPosts.length > 0) {
      // Extract text content from posts with their corresponding post objects
      const postsWithText = unprocessedTwitterPosts.map(post => {
        const textElement = post.querySelector('[data-testid="tweetText"]');
        const text = textElement ? textElement.textContent.trim() : '';
        return { post, text };
      }).filter(item => item.text.length > 0); // Filter out empty texts
      
      // Extract just the texts for API call
      const textsToAnalyze = postsWithText.map(item => item.text);
      
      if (textsToAnalyze.length > 0) {
        debugLog(`Analyzing ${textsToAnalyze.length} Twitter texts with Claude API and keywords`);
        console.log("Sample tweet text:", textsToAnalyze[0].substring(0, 100));
        
        // First do keyword analysis for all texts
        const keywordResults = textsToAnalyze.map(text => analyzeTextWithKeywords(text));
        
        // Then try API analysis
        let apiResults = [];
        try {
          apiResults = await window.textAnalysisAPI.analyzeTexts(textsToAnalyze);
          debugLog(`Received ${apiResults.length} results from API`);
          console.log(`Text analysis results for ${apiResults.length} tweets`);
        } catch (error) {
          console.error("Error analyzing Twitter texts with API:", error);
          // If API fails, we'll use just the keyword results
          apiResults = new Array(textsToAnalyze.length).fill('safe');
        }
        
        // Combine API and keyword results, preferring the more sensitive category
        // (non-safe category takes precedence)
        const combinedResults = apiResults.map((apiResult, index) => {
          const keywordResult = keywordResults[index];
          
          // If either result is non-safe, use that result
          if (!isSafeCategory(apiResult) || !isSafeCategory(keywordResult)) {
            // If both are sensitive, prioritize API result but note the keyword match
            if (!isSafeCategory(apiResult) && !isSafeCategory(keywordResult)) {
              console.log(`Both API (${apiResult}) and keywords (${keywordResult}) detected sensitivity`);
              return apiResult; // Prioritize API for category specificity
            }
            // Otherwise return whichever is sensitive
            return isSafeCategory(apiResult) ? keywordResult : apiResult;
          }
          
          // If both are safe, return the API result
          return apiResult;
        });
        
        // Map combined results back to posts
        postsWithText.forEach((item, index) => {
          const postId = getPostId(item.post);
          twitterTextResults[postId] = combinedResults[index];
          console.log(`Assigned combined category '${combinedResults[index]}' to post`, 
                       item.text.substring(0, 30), 
                       `(API: ${apiResults[index]}, Keywords: ${keywordResults[index]})`);
        });
      }
    }
    
    // Process Threads posts using the same combined approach
    if (unprocessedThreadsPosts.length > 0) {
      // Extract text content from posts with their corresponding post objects
      const postsWithText = unprocessedThreadsPosts.map(post => {
        const text = post.innerText.trim();
        return { post, text };
      }).filter(item => item.text.length > 0); // Filter out empty texts
      
      // Extract just the texts for API call
      const textsToAnalyze = postsWithText.map(item => item.text);
      
      if (textsToAnalyze.length > 0) {
        debugLog(`Analyzing ${textsToAnalyze.length} Threads texts with Claude API and keywords`);
        
        // First do keyword analysis for all texts
        const keywordResults = textsToAnalyze.map(text => analyzeTextWithKeywords(text));
        
        // Then try API analysis
        let apiResults = [];
        try {
          apiResults = await window.textAnalysisAPI.analyzeTexts(textsToAnalyze);
          debugLog(`Received ${apiResults.length} results from API`);
        } catch (error) {
          console.error("Error analyzing Threads texts with API:", error);
          // If API fails, we'll use just the keyword results
          apiResults = new Array(textsToAnalyze.length).fill('safe');
        }
        
        // Combine API and keyword results, preferring the more sensitive category
        const combinedResults = apiResults.map((apiResult, index) => {
          const keywordResult = keywordResults[index];
          
          // If either result is non-safe, use that result
          if (!isSafeCategory(apiResult) || !isSafeCategory(keywordResult)) {
            // If both are sensitive, prioritize API result but note the keyword match
            if (!isSafeCategory(apiResult) && !isSafeCategory(keywordResult)) {
              console.log(`Both API (${apiResult}) and keywords (${keywordResult}) detected sensitivity`);
              return apiResult; // Prioritize API for category specificity
            }
            // Otherwise return whichever is sensitive
            return isSafeCategory(apiResult) ? keywordResult : apiResult;
          }
          
          // If both are safe, return the API result
          return apiResult;
        });
        
        // Map combined results back to posts
        postsWithText.forEach((item, index) => {
          const postId = getPostId(item.post);
          threadsTextResults[postId] = combinedResults[index];
          console.log(`Assigned combined category '${combinedResults[index]}' to Threads post`, 
                      `(API: ${apiResults[index]}, Keywords: ${keywordResults[index]})`);
        });
      }
    }
  } catch (error) {
    console.error("Error in combined batch text analysis:", error);
  } finally {
    pendingTextAnalysis = false;
  }
}

// Enhanced keyword analysis function for more comprehensive detection
function analyzeTextWithKeywords(text) {
  const lowercaseText = text.toLowerCase();
  
  // Check each category's keywords
  for (const [category, keywords] of Object.entries(categoryKeywords)) {
    if (preferences[category] && keywords.some(keyword => lowercaseText.includes(keyword))) {
      console.log(`Keyword match found in text: category ${category}, keyword: ${keywords.find(k => lowercaseText.includes(k))}`);
      return category;
    }
  }
  
  // Additional check for Arabic-specific patterns (example implementation)
  // This is where you can add more sophisticated Arabic text analysis
  
  // Check for Quranic patterns that should be marked as Islamic content
  if (/\bبسم الله\b|\bقال الله\b|\bقال تعالى\b|\bآية\b|\bسورة\b/i.test(text)) {
    return 'Islam'; // Mark as Islamic content rather than sensitive
  }
  
  // If no matches found, mark as safe
  return 'safe';
}

// ==========================================
// IMAGE ANALYSIS FUNCTIONS
// ==========================================

// Improved image processing with better error handling and logging
async function processImageWithModel(img) {
  try {
    debugLog("Processing image through background script:", img.src ? img.src.substring(0, 100) + "..." : "no src");
    console.log("Processing image:", img.width, "x", img.height, "src:", img.src ? img.src.substring(0, 50) + "..." : "no src");
    
    // Skip tiny or invalid images
    if (!img.src || img.width < 100 || img.height < 100) {
      debugLog("Skipping small or invalid image");
      return { is_sensitive: false, reason: "image_too_small_or_invalid" };
    }
    
    // Get image data
    let imageData;
    
    // For data URLs, use directly
    if (img.src && (img.src.startsWith('data:') || img.src.startsWith('blob:'))) {
      imageData = img.src;
      debugLog("Using direct data URL for image");
    } else {
      // For HTTP URLs, use the background script to fetch
      debugLog("Fetching image data through background script");
      try {
        imageData = await new Promise((resolve, reject) => {
          const fetchTimeout = setTimeout(() => {
            reject(new Error("Timeout fetching image data"));
          }, 10000); // 10 second timeout
          
          chrome.runtime.sendMessage(
            { action: "fetchImage", imageUrl: img.src }, 
            (response) => {
              clearTimeout(fetchTimeout);
              
              if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
              }
              
              if (response && response.success) {
                resolve(response.dataUrl);
              } else {
                reject(new Error(response?.error || "Unknown error fetching image"));
              }
            }
          );
        });
      } catch (fetchError) {
        debugLog("Error fetching image data:", fetchError.message);
        return { is_sensitive: false, error: fetchError.message };
      }
    }
    
    if (!imageData) {
      debugLog("No image data available");
      return { is_sensitive: false, reason: "image_data_unavailable" };
    }
    
    // Send to background for processing with the real model
    debugLog("Sending image to background for processing");
    try {
      const result = await new Promise((resolve, reject) => {
        const processTimeout = setTimeout(() => {
          reject(new Error("Timeout processing image"));
        }, 15000); // 15 second timeout
        
        chrome.runtime.sendMessage(
          { 
            action: "processImageWithWorker", 
            imageData: imageData,
            threshold: 0.15 // Explicitly set threshold for consistent results
          },
          (response) => {
            clearTimeout(processTimeout);
            
            if (chrome.runtime.lastError) {
              debugLog("Error from background script: " + chrome.runtime.lastError.message);
              reject(new Error(chrome.runtime.lastError.message));
              return;
            }
            
            if (response && response.success) {
              debugLog("Background model processing result: " + JSON.stringify(response.result));
              console.log("Image analysis result:", response.result);
              resolve(response.result);
            } else {
              debugLog("Error in background model processing: " + (response?.error || "Unknown error"));
              reject(new Error(response?.error || "Unknown error in model processing"));
            }
          }
        );
      });
      
      return result;
    } catch (processingError) {
      debugLog("Error processing image with background model:", processingError.message);
      return { is_sensitive: false, error: processingError.message };
    }
  } catch (error) {
    console.error("Error in processImageWithModel:", error);
    return { is_sensitive: false, error: error.message || "Unknown error" };
  }
}

// New function to process posts with the loader
async function processPostsWithLoader(twitterPosts, threadsPosts) {
  // Show the loader
  const loader = createMisfahLoader("تحليل المحتوى");
  let progress = 0;
  
  // Start a progress simulation
  const progressInterval = setInterval(() => {
    progress += 5;
    if (progress <= 90) {
      loader.updateProgress(progress);
    }
  }, 300);
  
  try {
    // First do text analysis in batch
    await batchAnalyzePostsText();
    
    // Process the tweet batches
    // Create a modified version of filterContent that accepts specific post arrays
    let filteredCount = await filterSpecificPosts(twitterPosts, threadsPosts);
    
    // Complete the loader
    clearInterval(progressInterval);
    loader.updateProgress(100);
    loader.complete();
    
    return filteredCount;
  } catch (error) {
    clearInterval(progressInterval);
    loader.remove();
    console.error("Error during batch processing:", error);
    throw error;
  }
}

// Specific filtering function for the given posts
async function filterSpecificPosts(twitterPosts, threadsPosts) {
  if (!isEnabled) {
    debugLog("Filtering is disabled");
    return 0;
  }

  debugLog("Starting content filtering for specific posts");
  console.log(`Processing ${twitterPosts.length} Twitter posts, ${threadsPosts.length} Threads posts`);

  let filteredCount = 0;

  // Filter Twitter posts
  for (const post of twitterPosts) {
    // Skip already processed posts
    if (isPostProcessedByMisfah(post) || hiddenPosts.has(post)) {
      console.log("Skipping already processed post");
      continue;
    }
    
    try {
      // Mark post as processed to avoid reprocessing
      processedPosts.add(post);
      post.dataset.misfahProcessed = "true";
      
      // Get text analysis result from our batch processing
      const postId = getPostId(post);
      const textCategory = twitterTextResults[postId] || 'safe';
      console.log(`Tweet ${postId} text category:`, textCategory);
      
      // Initialize variables
      let shouldHide = shouldHideContent(textCategory, preferences);
      let sensitiveCategories = shouldHide ? [textCategory] : [];
      let imageResult = null;

      // If text wasn't sensitive, check for images
      if (!shouldHide) {
        console.log("Text not sensitive, checking images");
        const modelStatus = await new Promise(resolve => {
          chrome.runtime.sendMessage({ action: "getModelStatus" }, response => {
            resolve(response || { isLoaded: false });
          });
        });
        
        if (modelStatus.isLoaded) {
          const images = findImagesInPost(post);
          console.log(`Found ${images.length} images in tweet`);
          
          for (const img of images) {
            if (!img.complete) {
              await new Promise(resolve => {
                img.onload = resolve;
                img.onerror = resolve;
                setTimeout(resolve, 1000);
              });
            }
            
            if (img.width < 100 || img.height < 100) continue;
            
            try {
              imageResult = await processImageWithModel(img);
              console.log("Image analysis result:", imageResult);
              
              if (imageResult && imageResult.is_sensitive) {
                shouldHide = true;
                sensitiveCategories = imageResult.detected_categories || [];
                break;
              }
            } catch (imgError) {
              console.error(`Error processing image: ${imgError.message}`);
            }
          }
        }
      }

      // Apply filtering if the post contains sensitive content
      if (shouldHide) {
        const originalContent = post.innerHTML;
        createFilteredPostPlaceholder(post, sensitiveCategories, originalContent);
        hiddenPosts.add(post);
        twitterFilteredCount++;
        filteredCount++;
        
        console.log(`HIDDEN TWEET: Category: ${sensitiveCategories.join(', ')}`);
      } else {
        console.log("Tweet is safe, not hiding");
      }
    } catch (error) {
      console.error("Error filtering Twitter post:", error);
    }
  }

  // Process Threads posts similarly
  for (const post of threadsPosts) {
    if (isPostProcessedByMisfah(post) || hiddenPosts.has(post)) {
      continue;
    }
    
    try {
      processedPosts.add(post);
      post.dataset.misfahProcessed = "true";
      
      const postId = getPostId(post);
      const textCategory = threadsTextResults[postId] || 'safe';
      
      let shouldHide = shouldHideContent(textCategory, preferences);
      let sensitiveCategories = shouldHide ? [textCategory] : [];
      let imageResult = null;

      if (!shouldHide) {
        const modelStatus = await new Promise(resolve => {
          chrome.runtime.sendMessage({ action: "getModelStatus" }, response => {
            resolve(response || { isLoaded: false });
          });
        });
        
        if (modelStatus.isLoaded) {
          const images = post.querySelectorAll('img:not([alt="Profile photo"])');
          
          for (const img of images) {
            if (!img.complete) {
              await new Promise(resolve => {
                img.onload = resolve;
                img.onerror = resolve;
                setTimeout(resolve, 1000);
              });
            }
            
            if (img.width < 100 || img.height < 100) continue;
            
            try {
              imageResult = await processImageWithModel(img);
              
              if (imageResult && imageResult.is_sensitive) {
                shouldHide = true;
                sensitiveCategories = imageResult.detected_categories || [];
                break;
              }
            } catch (imgError) {
              console.error(`Error processing image: ${imgError.message}`);
            }
          }
        }
      }

      if (shouldHide) {
        const originalContent = post.innerHTML;
        createFilteredPostPlaceholder(post, sensitiveCategories, originalContent);
        hiddenPosts.add(post);
        threadsFilteredCount++;
        filteredCount++;
        
        console.log(`HIDDEN THREADS POST: Category: ${sensitiveCategories.join(', ')}`);
      }
    } catch (error) {
      console.error("Error filtering Threads post:", error);
    }
  }

  // Save updated statistics to Chrome storage
  if (filteredCount > 0) {
    throttledStorageSave({
      twitterFilteredCount,
      threadsFilteredCount
    });
  }
  
  return filteredCount;
}

// ==========================================
// CONTENT FILTERING MAIN FUNCTIONS
// ==========================================

// Modify the runFilterContent function to respect the batch limit
async function runFilterContent(forceContinuousProcessing = false) {
  console.log("Starting filtering with loader");
  debugLog("🔍 runFilterContent called - isEnabled=" + isEnabled);
  console.log("🔍 Starting filtering process - enabled=" + isEnabled);
  
  if (!isEnabled) {
    return 0;
  }
  
  // Get all posts
  const { twitterPosts, threadsPosts } = getPosts();
  
  // If we've already processed the initial batch and continuous processing isn't forced,
  // don't process any more posts
  if (initialBatchProcessed && !forceContinuousProcessing && !manualProcessingEnabled) {
    console.log("Initial batch already processed. Skipping automatic processing.");
    return 0;
  }
  
  // Filter posts to only get unprocessed ones
  const unprocessedTwitterPosts = Array.from(twitterPosts).filter(post => 
    !isPostProcessedByMisfah(post) && !hiddenPosts.has(post)
  );
  const unprocessedThreadsPosts = Array.from(threadsPosts).filter(post => 
    !isPostProcessedByMisfah(post) && !hiddenPosts.has(post)
  );
  
  // Calculate total unprocessed posts
  const totalUnprocessed = unprocessedTwitterPosts.length + unprocessedThreadsPosts.length;
  console.log(`Found ${totalUnprocessed} unprocessed posts`);
  
  // If we're processing the initial batch, limit the number of posts to process
  if (!initialBatchProcessed) {
    // Limit the posts to process to INITIAL_BATCH_SIZE
    const twitterPostsToProcess = unprocessedTwitterPosts.slice(0, INITIAL_BATCH_SIZE);
    const threadsPostsToProcess = unprocessedThreadsPosts.slice(0, INITIAL_BATCH_SIZE - twitterPostsToProcess.length);
    
    console.log(`Processing initial batch: ${twitterPostsToProcess.length} Twitter posts and ${threadsPostsToProcess.length} Threads posts`);
    
    // Mark the rest as processed without actually analyzing them
    unprocessedTwitterPosts.slice(INITIAL_BATCH_SIZE).forEach(post => {
      processedPosts.add(post);
      post.dataset.misfahProcessed = "true";
    });
    
    unprocessedThreadsPosts.slice(INITIAL_BATCH_SIZE - twitterPostsToProcess.length).forEach(post => {
      processedPosts.add(post);
      post.dataset.misfahProcessed = "true";
    });
    
    // Use only the limited posts for actual processing
    const filteredCount = await processPostsWithLoader(twitterPostsToProcess, threadsPostsToProcess);
    
    // Mark initial batch as processed
    initialBatchProcessed = true;
    
    return filteredCount;
  } else if (totalUnprocessed > 0) {
    // If we're doing continuous processing or manual processing
    // First, do text analysis in batch
    await batchAnalyzePostsText();
    // Then process without the loader for subsequent batches
    return filterContent();
  }
  
  return 0;
}

// New function to process posts with the loader
async function processPostsWithLoader(twitterPosts, threadsPosts) {
  // Show the loader
  const loader = createMisfahLoader("تحليل المحتوى");
  let progress = 0;
  
  // Start a progress simulation
  const progressInterval = setInterval(() => {
    progress += 5;
    if (progress <= 90) {
      loader.updateProgress(progress);
    }
  }, 300);
  
  try {
    // First do text analysis in batch
    await batchAnalyzePostsText();
    
    // Process the tweet batches
    // Create a modified version of filterContent that accepts specific post arrays
    let filteredCount = await filterSpecificPosts(twitterPosts, threadsPosts);
    
    // Complete the loader
    clearInterval(progressInterval);
    loader.updateProgress(100);
    loader.complete();
    
    return filteredCount;
  } catch (error) {
    clearInterval(progressInterval);
    loader.remove();
    console.error("Error during batch processing:", error);
    throw error;
  }
}


// Show a minimal notification when all posts are processed
function createMinimalCompletionNotification() {
  const notification = document.createElement('div');
  notification.id = 'misfah-complete-notification';
  notification.textContent = 'تم الانتهاء من تحليل جميع المنشورات الظاهرة';
  notification.style.position = 'fixed';
  notification.style.bottom = '20px';
  notification.style.right = '20px';
  notification.style.backgroundColor = 'rgba(40, 167, 69, 0.9)'; // Semi-transparent green
  notification.style.color = 'white';
  notification.style.padding = '8px 12px';
  notification.style.borderRadius = '20px';
  notification.style.zIndex = '10000';
  notification.style.fontFamily = 'IBM Plex Sans Arabic, Arial, sans-serif';
  notification.style.boxShadow = '0 2px 5px rgba(0, 0, 0, 0.2)';
  notification.style.fontSize = '14px';
  
  document.body.appendChild(notification);
  
  // Remove after 2 seconds
  setTimeout(() => {
    if (notification.parentNode) {
      notification.parentNode.removeChild(notification);
    }
  }, 2000);
}

// Show a notification when all posts are processed
function createProcessingCompleteNotification() {
  const notification = document.createElement('div');
  notification.id = 'misfah-complete-notification';
  notification.textContent = 'تم الانتهاء من تحليل جميع المنشورات الظاهرة';
  notification.style.position = 'fixed';
  notification.style.bottom = '80px';
  notification.style.right = '20px';
  notification.style.backgroundColor = '#28a745'; // Green for success
  notification.style.color = 'white';
  notification.style.padding = '10px 15px';
  notification.style.borderRadius = '20px';
  notification.style.zIndex = '10000';
  notification.style.fontFamily = 'IBM Plex Sans Arabic, Arial, sans-serif';
  notification.style.boxShadow = '0 2px 5px rgba(0,0,0,0.2)';
  
  document.body.appendChild(notification);
  
  // Remove after 3 seconds
  setTimeout(() => {
    if (notification.parentNode) {
      notification.parentNode.removeChild(notification);
    }
  }, 3000);
}


// Function to update the processing counter
function updateProcessingCounter() {
  const counterDisplay = document.getElementById('misfah-counter');
  if (counterDisplay) {
    const stats = window.misfah.getStats();
    const totalProcessed = stats.processedPosts; 
    const totalFiltered = stats.twitterFiltered + stats.threadsFiltered;
    
    counterDisplay.textContent = `تم تحليل: ${totalProcessed} منشور | تم تصفية: ${totalFiltered} | ${processedBatchCount} دفعات`;
  }
}



// New function to filter specific posts
async function filterSpecificPosts(twitterPosts, threadsPosts) {
  if (!isEnabled) {
    debugLog("Filtering is disabled");
    return 0;
  }

  debugLog("Starting content filtering for specific posts");
  console.log(`Processing ${twitterPosts.length} Twitter posts, ${threadsPosts.length} Threads posts`);

  let filteredCount = 0;

  // Filter Twitter posts
  for (const post of twitterPosts) {
    // Skip already processed posts
    if (isPostProcessedByMisfah(post) || hiddenPosts.has(post)) {
      console.log("Skipping already processed post");
      continue;
    }
    
    try {
      // Rest of your existing filtering code for Twitter posts
      // Mark post as processed to avoid reprocessing
      processedPosts.add(post);
      post.dataset.misfahProcessed = "true";
      
      // Get text analysis result from our batch processing
      const postId = getPostId(post);
      const textCategory = twitterTextResults[postId] || 'safe';
      
      // Initialize variables for filtering
      let shouldHide = shouldHideContent(textCategory, preferences);
      let sensitiveCategories = shouldHide ? [textCategory] : [];
      let imageResult = null;

      // Process images if text wasn't sensitive
      if (!shouldHide) {
        // Image processing code (same as your existing code)
        const modelStatus = await new Promise(resolve => {
          chrome.runtime.sendMessage({ action: "getModelStatus" }, response => {
            resolve(response || { isLoaded: false });
          });
        });
        
        if (modelStatus.isLoaded) {
          const images = findImagesInPost(post);
          
          for (const img of images) {
            if (!img.complete) {
              await new Promise(resolve => {
                img.onload = resolve;
                img.onerror = resolve;
                setTimeout(resolve, 1000);
              });
            }
            
            if (img.width < 100 || img.height < 100) continue;
            
            try {
              imageResult = await processImageWithModel(img);
              
              if (imageResult && imageResult.is_sensitive) {
                shouldHide = true;
                sensitiveCategories = imageResult.detected_categories || [];
                break;
              }
            } catch (imgError) {
              debugLog(`Error processing image: ${imgError.message}`);
            }
          }
        }
      }

      // Apply filtering if needed
      if (shouldHide) {
        const originalContent = post.innerHTML;
        createFilteredPostPlaceholder(post, sensitiveCategories, originalContent);
        hiddenPosts.add(post);
        twitterFilteredCount++;
        filteredCount++;
        
        const categoryNames = sensitiveCategories.join(', ');
        createWebpageAlert(
          `تنبيه: تم حجب محتوى حساس: ${categoryNames}`, 
          imageResult
        );
      }
    } catch (error) {
      console.error("Error filtering Twitter post:", error);
    }
  }

  // Filter Threads posts (same structure as above, just with your Threads-specific code)
  for (const post of threadsPosts) {
    // Same filtering logic as for Twitter posts
    // Just use your existing Threads post filtering code
    // ...
  }

  // Save updated statistics to Chrome storage
  if (filteredCount > 0) {
    throttledStorageSave({
      twitterFilteredCount,
      threadsFilteredCount
    });
  }
  
  return filteredCount;
}



// Modified filterContent function to use placeholders instead of hiding content
async function filterContent() {
  if (!isEnabled) {
    debugLog("Filtering is disabled");
    return;
  }

  debugLog("Starting content filtering with Claude API and ML model");
  const { twitterPosts, threadsPosts } = getPosts();
  debugLog(`Found ${twitterPosts.length} Twitter posts, ${threadsPosts.length} Threads posts`);
  console.log("Raw posts found:", twitterPosts.length, "Twitter posts,", threadsPosts.length, "Threads posts");

  // First, analyze texts in batch if needed
  await batchAnalyzePostsText();

  let filteredCount = 0;

  // Filter Twitter posts
  for (const post of twitterPosts) {
    // Skip already processed posts - improved check
    if (isPostProcessedByMisfah(post) || hiddenPosts.has(post)) {
      console.log("Skipping already processed post");
      continue;
    }
    
    try {
      // Mark post as processed to avoid reprocessing
      processedPosts.add(post);
      post.dataset.misfahProcessed = "true";
      
      // Log the post content for debugging
      const textElement = post.querySelector('[data-testid="tweetText"]');
      const textContent = textElement ? textElement.textContent.trim() : 'No text';
      console.log("Analyzing tweet:", textContent.substring(0, 100) + "...");
      
      // Get text analysis result from our batch processing
      const postId = getPostId(post);
      const textCategory = twitterTextResults[postId] || 'safe';
      console.log(`Tweet ${postId} text category:`, textCategory);
      
      // Initialize variables
      // Use the updated function to check if content should be hidden
      let shouldHide = shouldHideContent(textCategory, preferences);
      let sensitiveCategories = shouldHide ? [textCategory] : [];
      let imageResult = null;

      // If text wasn't sensitive, check for images
      if (!shouldHide) {
        console.log("Text not sensitive, checking images");
        // Check if the background model is ready
        const modelStatus = await new Promise(resolve => {
          chrome.runtime.sendMessage({ action: "getModelStatus" }, response => {
            resolve(response || { isLoaded: false });
          });
        });
        
        if (modelStatus.isLoaded) {
          // Find all valid images in the post
          const images = findImagesInPost(post);
          debugLog(`Found ${images.length} images in the post`);
          console.log(`Found ${images.length} images in the post`);
          
          for (const img of images) {
            // Wait for the image to be loaded
            if (!img.complete) {
              await new Promise(resolve => {
                img.onload = resolve;
                img.onerror = resolve;
                setTimeout(resolve, 1000); // Timeout after 1 second
              });
            }
            
            // Skip tiny images
            if (img.width < 100 || img.height < 100) {
              console.log("Skipping small image:", img.width, "x", img.height);
              continue;
            }
            
            try {
              // Process the image with the real model in background
              console.log("Processing image:", img.src ? img.src.substring(0, 100) + "..." : "no src");
              imageResult = await processImageWithModel(img);
              console.log("Image analysis result:", imageResult);
              
              if (imageResult && imageResult.is_sensitive) {
                shouldHide = true;
                sensitiveCategories = imageResult.detected_categories || [];
                debugLog(`Image detected as sensitive: ${sensitiveCategories.join(', ')}`);
                debugLog(`Detection confidence: ${imageResult.confidence}`);
                console.log(`IMAGE SENSITIVE: ${sensitiveCategories.join(', ')}, confidence: ${imageResult.confidence}`);
                break; // Stop processing more images in this post
              } else {
                console.log("Image not sensitive");
              }
            } catch (imgError) {
              debugLog(`Error processing image: ${imgError.message}`);
              console.error(`Error processing image: ${imgError.message}`);
              // Continue with next image
            }
          }
        } else {
          debugLog("Skipping image analysis - model not loaded");
          console.log("Skipping image analysis - model not loaded");
        }
      } else {
        debugLog(`Twitter post filtered by text analysis: ${textCategory}`);
        console.log(`SENSITIVE TEXT: Twitter post filtered by text analysis: ${textCategory}`);
      }

      // After analysis, log the result
      console.log("Tweet analysis result:", {
        postId: postId,
        category: textCategory,
        shouldHide: shouldHide,
        sensitiveCategories: sensitiveCategories
      });

      // Apply filtering if the post contains sensitive content
      if (shouldHide) {
        // Save the original HTML before modifying
        const originalContent = post.innerHTML;
        
        // Replace with placeholder instead of hiding
        createFilteredPostPlaceholder(post, sensitiveCategories, originalContent);
        
        // Add to hidden posts set to prevent reprocessing
        hiddenPosts.add(post);
        
        twitterFilteredCount++;
        filteredCount++;
        
        // If the post is hidden, log it clearly
        console.log("HIDDEN TWEET:", textContent.substring(0, 100) + "...", "Category:", sensitiveCategories.join(', '));
        
        // Show alert for sensitive content
        const categoryNames = sensitiveCategories.join(', ');
        createWebpageAlert(
          `تنبيه: تم حجب محتوى حساس: ${categoryNames}`, 
          imageResult // Pass the model result for confidence display
        );
      } else {
        console.log("Tweet is safe, not hiding");
      }
    } catch (error) {
      console.error("Error filtering Twitter post:", error);
    }
  }

  // Filter Threads posts with a similar approach
  for (const post of threadsPosts) {
    // Skip already processed posts - improved check
    if (isPostProcessedByMisfah(post) || hiddenPosts.has(post)) {
      console.log("Skipping already processed Threads post");
      continue;
    }
    
    try {
      // Mark post as processed to avoid reprocessing
      processedPosts.add(post);
      post.dataset.misfahProcessed = "true";
      
      // Log the post content for debugging
      const textContent = post.innerText.trim();
      console.log("Analyzing Threads post:", textContent.substring(0, 100) + "...");
      
      // Get text analysis result from our batch processing
      const postId = getPostId(post);
      const textCategory = threadsTextResults[postId] || 'safe';
      console.log(`Threads post ${postId} text category:`, textCategory);
      
      if (textCategory === "LGBTQ" || textCategory === "Astrology") {
        console.log(`Force-hiding sensitive category: ${textCategory}`);
        let shouldHide = true;
        let sensitiveCategories = [textCategory];
      }
      // Initialize variables
      // Use the updated function to check if content should be hidden
      let shouldHide = shouldHideContent(textCategory, preferences);
      let sensitiveCategories = shouldHide ? [textCategory] : [];
      let imageResult = null;

      // If text wasn't sensitive, check for images
      if (!shouldHide) {
        console.log("Text not sensitive, checking images");
        // Check if the background model is ready
        const modelStatus = await new Promise(resolve => {
          chrome.runtime.sendMessage({ action: "getModelStatus" }, response => {
            resolve(response || { isLoaded: false });
          });
        });
        
        if (modelStatus.isLoaded) {
          // Find images in the Threads post
          const images = post.querySelectorAll('img:not([alt="Profile photo"])'); // Exclude profile pictures
          debugLog(`Found ${images.length} images in Threads post`);
          console.log(`Found ${images.length} images in Threads post`);
          
          for (const img of images) {
            // Wait for the image to be loaded
            if (!img.complete) {
              await new Promise(resolve => {
                img.onload = resolve;
                img.onerror = resolve;
                setTimeout(resolve, 1000);
              });
            }
            
            // Skip tiny images
            if (img.width < 100 || img.height < 100) {
              console.log("Skipping small image:", img.width, "x", img.height);
              continue;
            }
            
            try {
              // Process with the real model in background
              console.log("Processing image:", img.src ? img.src.substring(0, 100) + "..." : "no src");
              imageResult = await processImageWithModel(img);
              console.log("Image analysis result:", imageResult);
              
              if (imageResult && imageResult.is_sensitive) {
                shouldHide = true;
                sensitiveCategories = imageResult.detected_categories || [];
                debugLog(`Image detected as sensitive: ${sensitiveCategories.join(', ')}`);
                console.log(`IMAGE SENSITIVE: ${sensitiveCategories.join(', ')}, confidence: ${imageResult.confidence}`);
                break;
              } else {
                console.log("Image not sensitive");
              }
            } catch (imgError) {
              debugLog(`Error processing image: ${imgError.message}`);
              console.error(`Error processing image: ${imgError.message}`);
              // Continue with next image
            }
          }
        } else {
          debugLog("Skipping image analysis - model not loaded");
          console.log("Skipping image analysis - model not loaded");
        }
      } else {
        debugLog(`Threads post filtered by text analysis: ${textCategory}`);
        console.log(`SENSITIVE TEXT: Threads post filtered by text analysis: ${textCategory}`);
      }

      // After analysis, log the result
      console.log("Threads post analysis result:", {
        postId: postId,
        category: textCategory,
        shouldHide: shouldHide, 
        sensitiveCategories: sensitiveCategories
      });

      // Apply filtering if the post contains sensitive content
      if (shouldHide) {
        // Save the original HTML before modifying
        const originalContent = post.innerHTML;
        
        // Replace with placeholder instead of hiding
        createFilteredPostPlaceholder(post, sensitiveCategories, originalContent);
        
        // Add to hidden posts set to prevent reprocessing
        hiddenPosts.add(post);
        
        threadsFilteredCount++;
        filteredCount++;
        
        // If the post is hidden, log it clearly
        console.log("HIDDEN THREADS POST:", textContent.substring(0, 100) + "...", "Category:", sensitiveCategories.join(', '));
        
        // Show alert for sensitive content
        const categoryNames = sensitiveCategories.join(', ');
        createWebpageAlert(
          `تنبيه: تم حجب محتوى حساس: ${categoryNames}`,
          imageResult
        );
      } else {
        console.log("Threads post is safe, not hiding");
      }
    } catch (error) {
      console.error("Error filtering Threads post:", error);
    }
  }

  // Save updated statistics to Chrome storage (with throttling)
  if (filteredCount > 0) {
    throttledStorageSave({
      twitterFilteredCount,
      threadsFilteredCount
    });
    console.log(`Filtered ${filteredCount} posts in total`);
  } else {
    console.log("No posts were filtered");
  }
  
  return filteredCount;
}

// ==========================================
// PLACEHOLDER & CONTENT HANDLING FUNCTIONS
// ==========================================

// Updated function to create a placeholder for filtered content instead of hiding it
function createFilteredPostPlaceholder(post, categories, originalContent) {
  // Get the post ID and store it permanently with its categories
  const postId = getPostId(post);
  
  // Store both the ID and categories
  hiddenPostsData[postId] = {
    categories: Array.isArray(categories) ? categories : [categories || 'sensitive'],
    timestamp: Date.now()
  };
  
  // Persist hidden post data to storage
  persistHiddenPosts();
  
  // Store the original display style
  post._originalDisplay = post.style.display;
  
  // Store the original content for restoration later
  post._originalContent = originalContent || post.innerHTML;
  
  // Store the categories for later reference
  post._sensitiveCategories = categories;
  post.dataset.misfahSensitiveCategories = Array.isArray(categories) ? 
    categories.join(',') : categories || 'sensitive';
  
  // Mark this post as having a placeholder (to avoid reprocessing)
  post.dataset.hasMisfahPlaceholder = "true";
  post.dataset.misfahPostId = postId;
  
  // Create a timestamp ID to ensure unique button IDs
  const uniqueId = Date.now() + Math.floor(Math.random() * 1000);
  
  // Format categories for display
  const categoryText = Array.isArray(categories) && categories.length > 0
    ? categories.join('، ') // Arabic comma
    : "محتوى غير مناسب";
  
  // Create placeholder content
  const placeholderHTML = `
    <div class="misfah-placeholder" style="border:1px solid #e0e0e0; border-radius:12px; background-color:#f8f8f8; 
               padding:15px; text-align:center; direction:rtl; margin:10px 0; position:relative;">
      <div style="position:absolute; top:10px; left:10px; font-size:12px; color:#888;">
        <span style="background-color:#4fa3f7; color:white; padding:2px 6px; border-radius:3px; font-size:10px;">مصفاة</span>
      </div>
      <div style="font-weight:bold; margin-bottom:10px; margin-top:10px; color:#333;">
        تم حجب محتوى حساس: ${categoryText}
      </div>
      <button id="misfah-show-content-${uniqueId}" style="background-color:#4fa3f7; border:none;
              border-radius:4px; padding:5px 10px; cursor:pointer; font-weight:bold; color:white;">
        إظهار المحتوى
      </button>
    </div>
  `;
  
  // Replace content with placeholder
  post.innerHTML = placeholderHTML;
  
  // Add event listener to the show button
  setTimeout(() => {
  // Get the placeholder container
  const placeholderContainer = post.querySelector('.misfah-placeholder');
  
  if (placeholderContainer) {
    // Prevent clicks on the placeholder div from propagating to parent elements
    // EXCEPT for clicks on the show button
    placeholderContainer.addEventListener('click', function(event) {
      // Check if the click was on or inside the button
      const showButton = document.getElementById(`misfah-show-content-${uniqueId}`);
      if (showButton && (event.target === showButton || showButton.contains(event.target))) {
        // Allow clicks on the button to proceed normally
        console.log("Button clicked - allowing event");
        return true;
      }
      
      // For all other elements, prevent the default action and stop propagation
      event.stopPropagation();
      event.preventDefault();
      console.log("Placeholder clicked (not on button) - preventing navigation");
      return false;
    }, true); // Use capture phase to ensure we catch the event first
  }

    const showButton = document.getElementById(`misfah-show-content-${uniqueId}`);
    if (showButton) {
      showButton.addEventListener('click', function(event) {
        // Prevent event propagation
        event.preventDefault();
        event.stopPropagation();
        
        console.log("Show content button clicked for post ID:", postId);
        
        // Remove this ID from the hidden posts tracking
        delete hiddenPostsData[postId];
        
        // Update the persistent storage
        persistHiddenPosts();
        
        // Restore original content if available
        if (post._originalContent) {
          console.log("Restoring original content");
          post.innerHTML = post._originalContent;
          
          // Add a visual sensitive content indicator wrapper
          addSensitiveContentIndicator(post, categories);
          
          // Mark as viewed to prevent reprocessing
          processedPosts.add(post); // Add to processed set
          post.dataset.misfahContentViewed = "true";
          post.dataset.misfahProcessed = "true"; // Add this to prevent reprocessing
          delete post.dataset.hasMisfahPlaceholder;
          
          // Mark the post with a special attribute to indicate it was explicitly shown by user
          post.dataset.misfahUserShown = "true";
          
          console.log("Misfah: Content restored by user action but marked as sensitive");
        } else {
          // If original content isn't available, we need to unhide the post
          // and let it reload naturally
          console.log("No original content - removing placeholder and letting the post reload");
          post.innerHTML = `<div style="padding: 20px; text-align: center;">جارٍ تحميل المحتوى...</div>`;
          processedPosts.add(post);
          post.dataset.misfahContentViewed = "true";
          post.dataset.misfahProcessed = "true";
          post.dataset.misfahUserShown = "true";
          delete post.dataset.hasMisfahPlaceholder;
          
          // Force a reprocessing of the timeline to refresh this post
          setTimeout(() => {
            const postContainer = post.closest('[data-testid="cellInnerDiv"]');
            if (postContainer) {
              // Try to nudge Twitter to refresh this post
              postContainer.style.opacity = "0.99";
              setTimeout(() => postContainer.style.opacity = "1", 50);
            }
          }, 100);
        }
        
        return false;
      });
    } else {
      console.error("Show content button not found for ID:", uniqueId);
    }
  }, 0);
}

// Function to add a visual indicator for sensitive content that has been shown
function addSensitiveContentIndicator(post, categories) {
  // Get post ID to ensure we don't re-hide this post
  const postId = getPostId(post);
  
  // Make sure this post stays visible by removing from tracking
  if (hiddenPostsData[postId]) {
    delete hiddenPostsData[postId];
    persistHiddenPosts();
  }
  
  // Format categories for the warning banner
  const categoryText = Array.isArray(categories) && categories.length > 0
    ? categories.join('، ') // Arabic comma
    : "محتوى غير مناسب";
  
  // Create a warning banner at the top of the post
  const warningBanner = document.createElement('div');
  warningBanner.className = 'misfah-sensitive-indicator';
  warningBanner.innerHTML = `
    <div class="misfah-warning-icon">⚠️</div>
    <div class="misfah-warning-text">محتوى حساس: ${categoryText}</div>
  `;
  
  // Create a red outline for the post
  post.classList.add('misfah-sensitive-content');
  
  // Add the banner to the beginning of the post
  if (post.firstChild) {
    post.insertBefore(warningBanner, post.firstChild);
  } else {
    post.appendChild(warningBanner);
  }
}

// Function to show all content
function showAllContent() {
  const { twitterPosts, threadsPosts } = getPosts();
  
  // Process Twitter posts
  twitterPosts.forEach((post) => {
    // If this post has a placeholder, restore original content
    if (post.dataset.hasMisfahPlaceholder === "true" && post._originalContent) {
      post.innerHTML = post._originalContent;
      
      // Add sensitive content visual indicator
      if (post._sensitiveCategories) {
        addSensitiveContentIndicator(post, post._sensitiveCategories);
      }
      
      // Mark as viewed to prevent reprocessing
      post.dataset.misfahContentViewed = "true";
      delete post.dataset.hasMisfahPlaceholder;
    }
    // Ensure visible
    post.style.display = "";
  });
  
  // Process Threads posts
  threadsPosts.forEach((post) => {
    // If this post has a placeholder, restore original content
    if (post.dataset.hasMisfahPlaceholder === "true" && post._originalContent) {
      post.innerHTML = post._originalContent;
      
      // Add sensitive content visual indicator
      if (post._sensitiveCategories) {
        addSensitiveContentIndicator(post, post._sensitiveCategories);
      }
      
      // Mark as viewed to prevent reprocessing
      post.dataset.misfahContentViewed = "true";
      delete post.dataset.hasMisfahPlaceholder;
    }
    // Ensure visible
    post.style.display = "";
  });
  
  debugLog("Showing all posts with sensitive content indicators");
}

// ==========================================
// UI COMPONENTS & VISUAL FEEDBACK
// ==========================================

// Function to create and display an alert box on the webpage
function createWebpageAlert(message, modelResult = null, isError = false) {
  // For errors, always show. For normal alerts, limit frequency
  if (!isError) {
    // Limit alert frequency (no more than one every 5 seconds)
    const now = Date.now();
    if (now - lastAlertTime < 5000) {
      return; // Avoid showing alerts too frequently
    }
    lastAlertTime = now;
  }
  
  if (document.getElementById("webpage-alert")) {
    document.getElementById("webpage-alert").remove(); // Remove existing alert
  }

  const alertBox = document.createElement("div");
  alertBox.id = "webpage-alert";
  alertBox.style.position = "fixed";
  alertBox.style.top = "0";
  alertBox.style.left = "0";
  alertBox.style.width = "100%";
  alertBox.style.backgroundColor = isError ? "#e74c3c" : "#ff4d4d";
  alertBox.style.color = "white";
  alertBox.style.padding = "10px";
  alertBox.style.textAlign = "center";
  alertBox.style.zIndex = "10000";
  alertBox.style.fontSize = "16px";
  alertBox.style.fontWeight = "bold";
  alertBox.style.direction = "rtl"; // Right-to-left for Arabic
  
  // Add the main message
  const messageElement = document.createElement("div");
  messageElement.textContent = message || "تنبيه: قد تحتوي هذه الصفحة على محتوى غير مرغوب بناءً على اختياراتك";
  alertBox.appendChild(messageElement);
  
  // Add model confidence info if available
  if (modelResult && modelResult.confidence) {
    const confidencePercent = Math.round(modelResult.confidence * 100);
    const detailsElement = document.createElement("div");
    detailsElement.style.fontSize = "12px";
    detailsElement.style.marginTop = "5px";
    detailsElement.style.fontWeight = "normal";
    
    // Add model-specific details
    let detailsText = `نسبة الثقة: ${confidencePercent}%`;
    
    // Add information about detected categories with top predictions
    if (modelResult.top_predictions && modelResult.top_predictions.length > 0) {
      detailsText += ` | الفئات: `;
      modelResult.top_predictions.forEach((pred, idx) => {
        if (idx > 0) detailsText += ", ";
        const predPercent = Math.round(pred.probability * 100);
        detailsText += `${pred.class_name} (${predPercent}%)`;
      });
    }
    
    detailsElement.textContent = detailsText;
    alertBox.appendChild(detailsElement);
  }

  // Add close button
  const closeButton = document.createElement("button");
  closeButton.textContent = "✖";
  closeButton.style.position = "absolute";
  closeButton.style.top = "2px";
  closeButton.style.right = "20px";
  closeButton.style.backgroundColor = "transparent";
  closeButton.style.color = "white";
  closeButton.style.border = "none";
  closeButton.style.padding = "5px 10px";
  closeButton.style.cursor = "pointer";
  closeButton.style.fontWeight = "bold";
  closeButton.style.fontSize = "16px";

  closeButton.addEventListener("click", () => {
    alertBox.remove();
  });

  alertBox.appendChild(closeButton);
  document.body.prepend(alertBox);
  
  // Auto-hide after 5 seconds for normal alerts, 10 seconds for errors
  setTimeout(() => {
    if (alertBox.parentNode) {
      alertBox.remove();
    }
  }, isError ? 10000 : 5000);
}

// Modified createMisfahLoader function that preserves scroll position
function createMisfahLoader(message) {
  console.log("Creating Misfah loader element...");
  
  // Save current scroll position
  const savedScrollPosition = window.scrollY;
  console.log("Saving scroll position:", savedScrollPosition);
  
  // Remove existing loader if present
  if (document.getElementById("webpage-loader")) {
    document.getElementById("webpage-loader").remove();
  }
  if (document.getElementById("webpage-loader-overlay")) {
    document.getElementById("webpage-loader-overlay").remove();
  }

  // Save the original body overflow style
  const originalBodyOverflow = document.body.style.overflow;
  
  // Create an overlay that doesn't block scrolling
  const overlay = document.createElement('div');
  overlay.id = "webpage-loader-overlay";
  overlay.style.position = "fixed";
  overlay.style.top = "0";
  overlay.style.left = "0";
  overlay.style.width = "100%";
  overlay.style.height = "100%";
  overlay.style.backgroundColor = "rgba(0, 0, 0, 0.5)";
  overlay.style.zIndex = "9999";
  overlay.style.pointerEvents = "none"; // Allow scrolling by letting events pass through
  document.body.appendChild(overlay);

  // Create the loader element positioned at bottom-right corner
  const loaderBox = document.createElement("div");
  loaderBox.id = "webpage-loader";
  loaderBox.style.position = "fixed";
  loaderBox.style.top = "50%";
  loaderBox.style.left = "50%";
  loaderBox.style.transform = "translate(-50%, -50%)";
  loaderBox.style.width = "320px";
  loaderBox.style.backgroundColor = "#ffffff";
  loaderBox.style.color = "#333333";
  loaderBox.style.padding = "20px";
  loaderBox.style.borderRadius = "10px";
  loaderBox.style.boxShadow = "0 4px 20px rgba(0, 0, 0, 0.2)";
  loaderBox.style.textAlign = "center";
  loaderBox.style.direction = "rtl";
  loaderBox.style.zIndex = "10000";
  loaderBox.style.fontFamily = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
  loaderBox.style.display = "flex";
  loaderBox.style.flexDirection = "column";
  loaderBox.style.alignItems = "center";
  loaderBox.style.pointerEvents = "auto"; // Make the loader itself clickable

  // Create the header/title with direct styles
  const title = document.createElement("div");
  title.textContent = message || "تحليل المحتوى";
  title.style.fontSize = "18px";
  title.style.fontWeight = "bold";
  title.style.marginBottom = "15px";
  title.style.color = "#333";
  title.style.width = "100%";
  loaderBox.appendChild(title);

  // Create spinner with direct styles
  const spinner = document.createElement("div");
  spinner.style.width = "40px";
  spinner.style.height = "40px";
  spinner.style.margin = "0 auto 15px auto";
  spinner.style.border = "4px solid rgba(0, 120, 255, 0.1)";
  spinner.style.borderRadius = "50%";
  spinner.style.borderLeftColor = "#0078ff";
  loaderBox.appendChild(spinner);

  // Add spinner animation directly in JS
  spinner.animate(
    [
      { transform: 'rotate(0deg)' },
      { transform: 'rotate(360deg)' }
    ],
    {
      duration: 1000,
      iterations: Infinity
    }
  );

  // Create progress text with direct styles
  const progressText = document.createElement("div");
  progressText.id = "loader-progress-text";
  progressText.textContent = `جارٍ تحليل المنشورات... (الدفعة ${processedBatchCount})`;
  progressText.style.fontSize = "14px";
  progressText.style.marginBottom = "10px";
  progressText.style.color = "#666";
  progressText.style.width = "100%";
  loaderBox.appendChild(progressText);

  // Create progress bar container with direct styles
  const progressBarContainer = document.createElement("div");
  progressBarContainer.style.width = "100%";
  progressBarContainer.style.height = "8px";
  progressBarContainer.style.backgroundColor = "#e9ecef";
  progressBarContainer.style.borderRadius = "4px";
  progressBarContainer.style.overflow = "hidden";
  progressBarContainer.style.marginBottom = "15px";
  loaderBox.appendChild(progressBarContainer);

  // Create progress bar fill with direct styles
  const progressBarFill = document.createElement("div");
  progressBarFill.id = "loader-progress-bar";
  progressBarFill.style.width = "0%";
  progressBarFill.style.height = "100%";
  progressBarFill.style.backgroundColor = "#0078ff";
  progressBarFill.style.borderRadius = "4px";
  progressBarFill.style.transition = "width 0.5s ease";
  progressBarContainer.appendChild(progressBarFill);

  // Add to document
  console.log("Appending loader to body...");
  document.body.appendChild(loaderBox);
  console.log("Loader should now be visible");
  
  return {
    updateProgress: function(percent) {
      console.log(`Updating progress to ${percent}%`);
      const progressBar = document.getElementById("loader-progress-bar");
      const progressTextElement = document.getElementById("loader-progress-text");
      
      if (progressBar) {
        progressBar.style.width = `${percent}%`;
      } else {
        console.error("Progress bar element not found");
      }
      
      if (progressTextElement) {
        progressTextElement.textContent = `جارٍ تحليل المنشورات... ${percent}% (الدفعة ${processedBatchCount})`;
      } else {
        console.error("Progress text element not found");
      }
    },
    
    complete: function() {
      console.log("Marking loader as complete");
      const progressBar = document.getElementById("loader-progress-bar");
      const progressTextElement = document.getElementById("loader-progress-text");
      
      if (progressBar) {
        progressBar.style.width = "100%";
        progressBar.style.backgroundColor = "#28a745"; // Change to green
      } else {
        console.error("Progress bar element not found for completion");
      }
      
      if (progressTextElement) {
        progressTextElement.textContent = "تم الانتهاء من التحليل";
      } else {
        console.error("Progress text element not found for completion");
      }
      
      // Auto-hide after 2 seconds
      console.log("Setting up auto-hide in 2 seconds");
      setTimeout(() => {
        // Restore body style
        document.body.style.overflow = originalBodyOverflow;
        
        // Remove elements
        if (document.getElementById("webpage-loader-overlay")) {
          document.getElementById("webpage-loader-overlay").remove();
        }
        if (document.getElementById("webpage-loader")) {
          document.getElementById("webpage-loader").remove();
        }
      }, 2000);
    },
    
    remove: function() {
      console.log("Manually removing loader");
      // Restore body styles
      document.body.style.overflow = originalBodyOverflow;
      
      // Remove elements
      if (document.getElementById("webpage-loader-overlay")) {
        document.getElementById("webpage-loader-overlay").remove();
      }
      if (document.getElementById("webpage-loader")) {
        document.getElementById("webpage-loader").remove();
      }
    }
  };
}

// Modify the mutation observer to respect the batch processing limit
function setupMutationObserver() {
  console.log("⚙️ Setting up mutation observer");
  debugLog("Setting up mutation observer");
  
  // Create a throttled observer to prevent too many runs
  let lastObserverRun = 0;
  const throttledObserver = new MutationObserver((mutations) => {
    const now = Date.now();
    
    // Check for posts that were hidden but are now visible again
    const currentPosts = getPosts();
    const allCurrentPosts = [...currentPosts.twitterPosts, ...currentPosts.threadsPosts];
    
    // Look for posts with IDs in our hiddenPostsData object
    for (const post of allCurrentPosts) {
      const postId = getPostId(post);
      
      // If this post should be hidden but isn't currently hidden
      if (hiddenPostsData[postId] && !post.dataset.hasMisfahPlaceholder) {
        // Skip if user manually showed this post
        if (post.dataset.misfahUserShown === "true") {
          continue;
        }
        
        // Get the saved categories from our data store
        const savedData = hiddenPostsData[postId];
        const categories = savedData.categories || ['sensitive'];
        
        // Re-create the placeholder with the correct categories
        createFilteredPostPlaceholder(post, categories, null);
        
        // Add to hiddenPosts set to prevent reprocessing
        hiddenPosts.add(post);
      }
    }
    
    // Check if we need to reset our processed posts tracking
    const wasReset = resetProcessedPostsTracking(mutations);
    
    // Only run continuous filtering if manually enabled or reset was triggered
    if ((manualProcessingEnabled || wasReset) && now - lastObserverRun > 1000) {
      lastObserverRun = now;
      if (isEnabled) {
        debugLog("Mutation observer triggered filtering");
        runFilterContent(wasReset); // Force processing if posts were reset
      }
    }
  });

  // Start observing the document with the configured parameters
  throttledObserver.observe(document.body, {
    childList: true,
    subtree: true,
  });

  // Clean up observer when extension is disabled/removed
  window.addEventListener("unload", () => {
    throttledObserver.disconnect();
  });
  
  debugLog("Mutation observer initialized");
}



// Add a function to use the loader with your existing filtering system
function processWithLoader(processingFunction) {
  console.log("Starting processing with loader");
  
  const loader = createMisfahLoader("تحليل المحتوى");
  let progress = 0;
  
  // Start a progress simulation
  const progressInterval = setInterval(() => {
    progress += 5;
    if (progress <= 90) {
      loader.updateProgress(progress);
    }
  }, 300);
  
  return Promise.resolve()
    .then(() => {
      // Call the actual processing function
      return processingFunction();
    })
    .then((result) => {
      // Complete the loader
      clearInterval(progressInterval);
      loader.updateProgress(100);
      loader.complete();
      return result;
    })
    .catch((error) => {
      // Handle errors
      clearInterval(progressInterval);
      loader.remove();
      console.error("Error during processing:", error);
      throw error;
    });
}

// Test function for the loader
function testMisfahLoader() {
  console.log("Starting Misfah loader test");
  
  // Create the loader
  const loader = createMisfahLoader("اختبار تحليل المحتوى - Misfah");
  
  // Update progress over time
  let progress = 0;
  const interval = setInterval(() => {
    progress += 10;
    loader.updateProgress(progress);
    
    if (progress >= 100) {
      clearInterval(interval);
      loader.complete();
      console.log("Loader test completed");
    }
  }, 500);
}

// ==========================================
// MUTATION & NAVIGATION OBSERVERS
// ==========================================

// Function to reset the processed posts tracking when new tweets are loaded
function resetProcessedPostsTracking(mutations) {
  // Count significant additions to the DOM
  const significantAdditions = mutations.reduce((count, mutation) => {
    return count + mutation.addedNodes.length;
  }, 0);
  
  // If we see several new nodes, likely new tweets loaded
  if (significantAdditions > 5) {
    debugLog(`Detected ${significantAdditions} new nodes - resetting processed posts tracking`);
    
    // Only reset processedPosts, but keep hiddenPosts to prevent infinite reprocessing
    processedPosts = new Set();
    return true;
  }
  
  return false;
}

// Add a button to the page to manually trigger processing
function addManualProcessingButton() {
  // Check if button already exists
  if (document.getElementById('misfah-process-more')) {
    return;
  }
  
  const buttonContainer = document.createElement('div');
  buttonContainer.id = 'misfah-button-container';
  buttonContainer.style.position = 'fixed';
  buttonContainer.style.bottom = '20px';
  buttonContainer.style.right = '20px';
  buttonContainer.style.zIndex = '10000';
  buttonContainer.style.display = 'flex';
  buttonContainer.style.flexDirection = 'column';
  buttonContainer.style.gap = '10px';
  
  const processButton = document.createElement('button');
  processButton.id = 'misfah-process-more';
  processButton.textContent = 'تحليل المزيد من المنشورات';
  processButton.style.backgroundColor = '#4fa3f7';
  processButton.style.color = 'white';
  processButton.style.border = 'none';
  processButton.style.borderRadius = '20px';
  processButton.style.padding = '10px 15px';
  processButton.style.cursor = 'pointer';
  processButton.style.fontWeight = 'bold';
  processButton.style.boxShadow = '0 2px 5px rgba(0,0,0,0.2)';
  processButton.style.fontFamily = 'IBM Plex Sans Arabic, Arial, sans-serif';
  
  processButton.addEventListener('click', () => {
    // Process another batch of posts
    runFilterContent(true);
  });
  
  const toggleButton = document.createElement('button');
  toggleButton.id = 'misfah-toggle-continuous';
  toggleButton.textContent = manualProcessingEnabled ? 'إيقاف التحليل المستمر' : 'تفعيل التحليل المستمر';
  toggleButton.style.backgroundColor = manualProcessingEnabled ? '#ff4d4d' : '#4fa3f7';
  toggleButton.style.color = 'white';
  toggleButton.style.border = 'none';
  toggleButton.style.borderRadius = '20px';
  toggleButton.style.padding = '10px 15px';
  toggleButton.style.cursor = 'pointer';
  toggleButton.style.fontWeight = 'bold';
  toggleButton.style.boxShadow = '0 2px 5px rgba(0,0,0,0.2)';
  toggleButton.style.fontFamily = 'IBM Plex Sans Arabic, Arial, sans-serif';
  
  toggleButton.addEventListener('click', () => {
    manualProcessingEnabled = !manualProcessingEnabled;
    toggleButton.textContent = manualProcessingEnabled ? 'إيقاف التحليل المستمر' : 'تفعيل التحليل المستمر';
    toggleButton.style.backgroundColor = manualProcessingEnabled ? '#ff4d4d' : '#4fa3f7';
    
    // If enabling continuous processing, process current posts
    if (manualProcessingEnabled) {
      runFilterContent(true);
    }
  });
  
  buttonContainer.appendChild(processButton);
  buttonContainer.appendChild(toggleButton);
  document.body.appendChild(buttonContainer);
}

// Add a toggle button function for the manual processing mode
function toggleManualProcessingMode(enable) {
  manualProcessingEnabled = enable;
  console.log(`Manual processing mode ${manualProcessingEnabled ? 'enabled' : 'disabled'}`);
  
  // Update UI if needed
  const toggleButton = document.getElementById('misfah-toggle-continuous');
  if (toggleButton) {
    toggleButton.textContent = manualProcessingEnabled ? 'إيقاف التحليل المستمر' : 'تفعيل التحليل المستمر';
    toggleButton.style.backgroundColor = manualProcessingEnabled ? '#ff4d4d' : '#4fa3f7';
  }
  
  // If enabling, trigger a processing run
  if (manualProcessingEnabled && !batchProcessingInProgress) {
    runFilterContent(true);
  }
}

// Update the addManualProcessingButton function to use the toggle function
function addManualProcessingButton() {
  // Check if button already exists
  if (document.getElementById('misfah-process-more')) {
    return;
  }
  
  const buttonContainer = document.createElement('div');
  buttonContainer.id = 'misfah-button-container';
  buttonContainer.style.position = 'fixed';
  buttonContainer.style.bottom = '20px';
  buttonContainer.style.right = '20px';
  buttonContainer.style.zIndex = '10000';
  buttonContainer.style.display = 'flex';
  buttonContainer.style.flexDirection = 'column';
  buttonContainer.style.gap = '10px';
  
  // Counter display element
  const counterDisplay = document.createElement('div');
  counterDisplay.id = 'misfah-counter';
  counterDisplay.textContent = 'تم تحليل: 0 منشور';
  counterDisplay.style.backgroundColor = 'rgba(79, 163, 247, 0.9)';
  counterDisplay.style.color = 'white';
  counterDisplay.style.borderRadius = '20px';
  counterDisplay.style.padding = '8px 12px';
  counterDisplay.style.textAlign = 'center';
  counterDisplay.style.fontSize = '14px';
  counterDisplay.style.fontFamily = 'IBM Plex Sans Arabic, Arial, sans-serif';
  counterDisplay.style.boxShadow = '0 2px 5px rgba(0,0,0,0.2)';
  counterDisplay.style.marginBottom = '5px';
  
  // Process button
  const processButton = document.createElement('button');
  processButton.id = 'misfah-process-more';
  processButton.textContent = 'تحليل المزيد من المنشورات';
  processButton.style.backgroundColor = '#4fa3f7';
  processButton.style.color = 'white';
  processButton.style.border = 'none';
  processButton.style.borderRadius = '20px';
  processButton.style.padding = '10px 15px';
  processButton.style.cursor = 'pointer';
  processButton.style.fontWeight = 'bold';
  processButton.style.boxShadow = '0 2px 5px rgba(0,0,0,0.2)';
  processButton.style.fontFamily = 'IBM Plex Sans Arabic, Arial, sans-serif';
  
  processButton.addEventListener('click', () => {
    // Process another batch of posts - make sure batchProcessingInProgress is false
    // to avoid issues with scheduling
    batchProcessingInProgress = false;
    runFilterContent(true);
  });

  toggleButton.addEventListener('click', () => {
    toggleManualProcessingMode(!manualProcessingEnabled);
  });
  
  // Toggle button
  const toggleButton = document.createElement('button');
  toggleButton.id = 'misfah-toggle-continuous';
  toggleButton.textContent = manualProcessingEnabled ? 'إيقاف التحليل المستمر' : 'تفعيل التحليل المستمر';
  toggleButton.style.backgroundColor = manualProcessingEnabled ? '#ff4d4d' : '#4fa3f7';
  toggleButton.style.color = 'white';
  toggleButton.style.border = 'none';
  toggleButton.style.borderRadius = '20px';
  toggleButton.style.padding = '10px 15px';
  toggleButton.style.cursor = 'pointer';
  toggleButton.style.fontWeight = 'bold';
  toggleButton.style.boxShadow = '0 2px 5px rgba(0,0,0,0.2)';
  toggleButton.style.fontFamily = 'IBM Plex Sans Arabic, Arial, sans-serif';
  
  toggleButton.addEventListener('click', () => {
    toggleManualProcessingMode(!manualProcessingEnabled);
  });
  
  // Function to update the counter
  function updateProcessingCounter() {
    const stats = window.misfah.getStats();
    const totalProcessed = stats.processedPosts; 
    const totalFiltered = stats.twitterFiltered + stats.threadsFiltered;
    
    counterDisplay.textContent = `تم تحليل: ${totalProcessed} منشور | تم تصفية: ${totalFiltered} | ${processedBatchCount} دفعات`;
  }
  
  // Update counter initially
  updateProcessingCounter();
  
  // Set up timer to update counter
  setInterval(updateProcessingCounter, 5000);
  
  buttonContainer.appendChild(counterDisplay);
  buttonContainer.appendChild(processButton);
  buttonContainer.appendChild(toggleButton);
  document.body.appendChild(buttonContainer);
}

// Update the initializeExtension function to add the manual processing button
function initializeExtension() {
  debugLog("Initializing extension...");
  
  // Load saved hidden posts
  loadHiddenPosts();
  
  // Load preferences and filter state from storage
  chrome.storage.sync.get(["preferences", "isEnabled", "twitterFilteredCount", "threadsFilteredCount", "threshold"], (data) => {
    debugLog("Initial filtering starting");
    
    if (data.preferences) {
      preferences = data.preferences;
    }
    if (data.isEnabled !== undefined) {
      isEnabled = data.isEnabled;
    }
    
    twitterFilteredCount = data.twitterFilteredCount || 0;
    threadsFilteredCount = data.threadsFilteredCount || 0;

    debugLog("Initial preferences loaded:", preferences);
    debugLog("Initial filtering state loaded:", isEnabled);
    
    // Initialize text API
    initializeTextAPI();
    
    // Setup URL change monitoring to reset state on navigation
    setupURLChangeMonitoring();
    
    // Initialize filtering
    checkModelAndStartFiltering();
    
    // Add the manual processing button
    setTimeout(() => {
      addManualProcessingButton();
    }, 5000);
  });
  
  debugLog("✅ Initialization complete - filter enabled: " + isEnabled);
  
  // Force an initial processing run
  setTimeout(() => {
    debugLog("🔄 Forcing initial content scan");
    runFilterContent();
  }, 3000);
}



// Modify the function to handle URL changes with our batch processing approach
function setupURLChangeMonitoring() {
  let lastURL = window.location.href;
  
  // Check for URL changes periodically
  setInterval(() => {
    const currentURL = window.location.href;
    if (currentURL !== lastURL) {
      debugLog(`URL changed from ${lastURL} to ${currentURL}, resetting state`);
      console.log("URL changed, resetting Misfah state");
      
      // Reset all tracking
      processedPosts = new Set();
      hiddenPosts = new Set();
      twitterTextResults = {};
      threadsTextResults = {};
      
      // Reset the initial batch flag to process new batch on new page
      initialBatchProcessed = false;
      
      // Run filtering after a small delay to let the new page load
      setTimeout(() => {
        if (isEnabled) {
          runFilterContent();
        }
      }, 1000);
      
      lastURL = currentURL;
    }
  }, 1000);
  
  // Also monitor for Twitter's SPA navigation events that don't change the URL
  document.addEventListener('click', (event) => {
    // Check if clicked element is a navigation link
    const isNavigation = event.target.closest('a[href^="/"]') || 
                        event.target.closest('a[role="link"]') ||
                        event.target.closest('[data-testid="AppTabBar_Home_Link"]') ||
                        event.target.closest('[data-testid="AppTabBar_Explore_Link"]');
    
    if (isNavigation) {
      debugLog("Navigation click detected, scheduling state reset");
      
      // Reset all tracking after a slight delay to ensure navigation completes
      setTimeout(() => {
        processedPosts = new Set();
        hiddenPosts = new Set();
        twitterTextResults = {};
        threadsTextResults = {};
        
        // Reset the initial batch flag to process new batch on new page
        initialBatchProcessed = false;
        
        // Run filtering if enabled
        if (isEnabled) {
          runFilterContent();
        }
      }, 1500);
    }
  });
  
  debugLog("URL change monitoring initialized");
}



// ==========================================
// MESSAGE HANDLING
// ==========================================

// Listen for messages from popup or background
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  if (message.action === "manualProcessPosts") {
    console.log("Manual processing request received from popup");
    
    // Get unprocessed posts
    const { twitterPosts, threadsPosts } = getPosts();
    const unprocessedTwitterPosts = Array.from(twitterPosts).filter(post => 
      !isPostProcessedByMisfah(post) && !hiddenPosts.has(post)
    );
    const unprocessedThreadsPosts = Array.from(threadsPosts).filter(post => 
      !isPostProcessedByMisfah(post) && !hiddenPosts.has(post)
    );
    
    const totalUnprocessed = unprocessedTwitterPosts.length + unprocessedThreadsPosts.length;
    console.log(`Found ${totalUnprocessed} unprocessed posts for manual processing`);
    
    if (totalUnprocessed === 0) {
      sendResponse({ 
        success: true, 
        processedCount: 0,
        message: "No unprocessed posts found" 
      });
      return true;
    }
    
    // Reset batch flags to ensure processing starts
    batchProcessingInProgress = false;
    
    // Process the next batch
    runFilterContent(true)
      .then(filteredCount => {
        console.log(`Manual processing completed. Filtered ${filteredCount} posts.`);
        sendResponse({ 
          success: true, 
          processedCount: Math.min(totalUnprocessed, 50), // We process max 50 at a time
          filteredCount: filteredCount
        });
      })
      .catch(error => {
        console.error("Error in manual processing:", error);
        sendResponse({ 
          success: false, 
          error: error.message 
        });
      });
    
    return true; // Keep the message channel open for async response
  }
  
  console.log("Message received in content script:", message);
  
  if (message.action === "updateApiKey") {
    if (window.textAnalysisAPI) {
      window.textAnalysisAPI.setApiKey(message.apiKey);
      console.log("API key updated from popup");
    }
    sendResponse({ success: true });
    return true;
  }

  if (message.action === "testApiConnection") {
    if (!window.textAnalysisAPI) {
      sendResponse({ 
        success: false, 
        error: "واجهة برمجة تحليل النصوص غير متوفرة" 
      });
      return true;
    }
    
    // Test the connection
    window.textAnalysisAPI.testConnection()
      .then(result => {
        if (result.success) {
          sendResponse({ 
            success: true, 
            message: "تم الاتصال بنجاح" 
          });
        } else {
          sendResponse({ 
            success: false, 
            error: result.error || "فشل الاتصال بالخادم" 
          });
        }
      })
      .catch(error => {
        console.error("API test error:", error);
        sendResponse({ 
          success: false, 
          error: error.message || "حدث خطأ أثناء الاتصال"
        });
      });
    
    return true;
  }

  if (message.action === "displayAlert") {
    createWebpageAlert(message.message);
    sendResponse({ success: true });
    return true;
  }
  
  if (message.action === "checkModelStatus") {
    // Forward to background script to get real status
    chrome.runtime.sendMessage({ action: "getModelStatus" }, (response) => {
      sendResponse({ 
        modelLoaded: response?.isLoaded || false,
        modelInitializing: response?.isLoading || false,
        modelError: response?.error || null
      });
    });
    return true;
  }
  
  if (message.action === "updateModelThreshold") {
    // Forward to background
    chrome.runtime.sendMessage({
      action: "updateModelThreshold",
      threshold: message.threshold
    });
    sendResponse({ success: true });
    return true;
  }
  
  if (message.action === "modelStatusUpdate") {
    // Received status update from background
    debugLog(`Received model status update: loaded=${message.isLoaded}, loading=${message.isLoading}`);
    sendResponse({ success: true });
    return true;
  }
  
  if (message.action === "modelError") {
    // Model encountered an error
    debugLog(`Received model error: ${message.error}`);
    createWebpageAlert(`حدث خطأ في تحميل النموذج: ${message.error}`, null, true);
    sendResponse({ success: true });
    return true;
  }
  
  if (message.action === "testLoader") {
    console.log("Test loader message received");
    testMisfahLoader();
    sendResponse({ success: true });
    return true;
  }
  
  return false;
});

// Extend window.misfah to include controls for batch processing
window.misfah = {
  forceReprocess: forceReprocessAllContent,
  processMorePosts: () => runFilterContent(true),
  toggleContinuousProcessing: () => {
    manualProcessingEnabled = !manualProcessingEnabled;
    return `Continuous processing ${manualProcessingEnabled ? 'enabled' : 'disabled'}`;
  },
  getStats: () => ({
    processedPosts: processedPosts.size,
    hiddenPosts: hiddenPosts.size,
    twitterResults: Object.keys(twitterTextResults).length,
    threadsResults: Object.keys(threadsTextResults).length,
    twitterFiltered: twitterFilteredCount,
    threadsFiltered: threadsFilteredCount,
    initialBatchProcessed: initialBatchProcessed,
    continuousProcessingEnabled: manualProcessingEnabled
  })
};


// Wait for DOM content to be loaded
document.addEventListener("DOMContentLoaded", function() {
  debugLog("DOM content loaded, initializing Misfah");
  
  // Initialize our extension
  initializeExtension();
});
function manuallyStartProcessing() {
  console.log("Manually starting initial processing");
  // Reset processing flags to ensure we can start fresh
  batchProcessingInProgress = false;
  initialBatchProcessed = false;
  
  // Run the filter content function with forced processing
  runFilterContent(true);
  
  return "Processing started manually";
}


// Immediate initialization to ensure filtering starts
console.log("🔄 Starting immediate initialization");
setTimeout(() => {
  debugLog("Initial filtering checking model");
  
  // Force a direct loading of initial settings
  chrome.storage.sync.get(["preferences", "isEnabled"], (data) => {
    if (data.isEnabled !== undefined) {
      isEnabled = data.isEnabled;
    }
    
    if (data.preferences) {
      preferences = data.preferences;
    }
    
    console.log("Loaded initial settings, isEnabled =", isEnabled);
    
    // Start checking model and filtering
    checkModelAndStartFiltering();
  });
}, 1000);