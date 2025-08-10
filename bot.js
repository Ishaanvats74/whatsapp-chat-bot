// Enhanced WhatsApp AI Bot with better error handling and stability
import pkg from 'whatsapp-web.js';
const { Client, LocalAuth, MessageMedia } = pkg;
import axios from "axios";
import fs from "fs";
import path from "path";
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log("🚀 Starting Enhanced WhatsApp AI Bot...");
console.log("📦 Loading dependencies...");

// Enhanced client configuration for better stability
const client = new Client({
  authStrategy: new LocalAuth({ 
    clientId: "whatsapp-ai-bot-v2",
    dataPath: path.join(__dirname, '.wwebjs_auth')
  }),
  puppeteer: {
    headless: true,
    args: [
      "--no-sandbox", 
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--no-first-run",
      "--no-zygote",
      "--disable-gpu",
      "--disable-web-security",
      "--disable-features=VizDisplayCompositor",
      "--single-process",
      "--disable-extensions",
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      "--disable-blink-features=AutomationControlled",
      "--no-default-browser-check",
      "--mute-audio"
    ],
    timeout: 120000, // Increased timeout to 2 minutes
    handleSIGINT: false,
    handleSIGTERM: false
  },
  webVersionCache: {
    type: 'remote',
    remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
  }
});

// Enhanced bot status tracking
let botStatus = {
  authenticated: false,
  ready: false,
  qrCode: null,
  lastActivity: Date.now(),
  connectionAttempts: 0,
  startTime: Date.now(),
  errors: [],
  messagesProcessed: 0
};

// Rate limiting and performance tracking
let lastApiCall = 0;
const API_COOLDOWN = 2000; // 2 seconds between API calls
const MAX_MESSAGE_LENGTH = 4000;
const MAX_ERRORS = 10;

console.log("🤖 Enhanced WhatsApp AI Bot Initializing...");
console.log("📋 Features: AI Text + Image Generation + Hindi Support + Enhanced Error Handling");

// Enhanced QR code handler
client.on("qr", async (qr) => {
  try {
    console.log("📱 QR RECEIVED - Length:", qr.length);
    console.log("🔗 QR Preview:", qr.substring(0, 50) + "...");
    
    botStatus.qrCode = qr;
    botStatus.connectionAttempts++;
    
    console.log(`[QR] Connection attempt #${botStatus.connectionAttempts}`);
    console.log("[QR] Please scan this QR code with WhatsApp on your phone");
    console.log("[QR] Go to: WhatsApp → Settings → Linked Devices → Link a Device");
    
    // Display QR in terminal (optional)
    try {
      const qrcode = await import('qrcode-terminal');
      qrcode.default.generate(qr, { small: true });
    } catch (qrError) {
      console.log("⚠️ QR terminal display not available (install qrcode-terminal for terminal QR)");
    }
    
    // Send QR to Flask backend with enhanced retry
    await sendQRToBackend(qr, 3);
  } catch (error) {
    console.error("❌ [QR] Error processing QR code:", error.message);
    addError("QR processing failed: " + error.message);
  }
});

// Enhanced ready handler
client.on("ready", async () => {
  try {
    console.log("🎉 [SUCCESS] WhatsApp Client is Ready!");
    
    // Safely access client info with better error handling
    let botNumber = "Unknown";
    let waVersion = "Unknown";
    
    try {
      botNumber = client.info?.wid?.user || client.info?.me?.user || "Unknown";
      waVersion = client.info?.phone?.wa_version || client.info?.version || "Unknown";
    } catch (infoError) {
      console.warn("⚠️ Could not retrieve client info:", infoError.message);
    }
    
    console.log("📞 Bot Number:", botNumber);
    console.log("📱 WhatsApp Version:", waVersion);
    console.log("⚡ Status: Bot is now active and listening for mentions");
    console.log("⏱️ Startup time:", Math.round((Date.now() - botStatus.startTime) / 1000), "seconds");
    
    botStatus.ready = true;
    botStatus.qrCode = null;
    botStatus.authenticated = true;
    botStatus.lastActivity = Date.now();
    
    // Notify Flask backend with better error handling
    await notifyBackendReady(3);
    
    console.log("✅ Bot initialization complete - Ready to respond to messages!");
  } catch (error) {
    console.error("❌ [READY] Error in ready handler:", error.message);
    addError("Ready handler failed: " + error.message);
  }
});

// Enhanced authentication handlers
client.on("authenticated", () => {
  console.log("🔐 [AUTH] Authentication successful!");
  botStatus.authenticated = true;
});

client.on("auth_failure", (msg) => {
  console.error("❌ [AUTH_FAIL] Authentication failed:", msg);
  botStatus.authenticated = false;
  botStatus.ready = false;
  addError("Authentication failed: " + msg);
  
  // Reset connection attempts after auth failure
  if (botStatus.connectionAttempts >= 3) {
    console.log("🔄 [RESET] Too many failed attempts, resetting...");
    setTimeout(() => {
      console.log("🔄 [EXIT] Exiting for restart...");
      process.exit(1);
    }, 5000);
  }
});

client.on("disconnected", (reason) => {
  console.log("🔌 [DISCONNECT] Bot disconnected. Reason:", reason);
  botStatus.ready = false;
  botStatus.authenticated = false;
  addError("Disconnected: " + reason);
  
  // Attempt to reconnect after a delay
  console.log("🔄 [RECONNECT] Attempting to reconnect in 10 seconds...");
  setTimeout(async () => {
    try {
      await client.initialize();
    } catch (reconnectError) {
      console.error("❌ [RECONNECT] Failed to reconnect:", reconnectError.message);
    }
  }, 10000);
});

// Enhanced status handlers
client.on("loading_screen", (percent, message) => {
  console.log(`📊 [LOADING] ${percent}% - ${message}`);
});

client.on('change_state', state => {
  console.log(`🔄 [STATE] Connection state: ${state}`);
  botStatus.lastActivity = Date.now();
});

// Enhanced function to send QR to Flask backend
async function sendQRToBackend(qr, maxRetries = 3) {
  let retries = 0;
  
  while (retries < maxRetries) {
    try {
      console.log(`📤 [QR] Sending QR to backend (attempt ${retries + 1}/${maxRetries})`);
      
      const response = await axios.post('http://localhost:5000/qr-update', {
        qr_code: qr,
        status: 'waiting_for_scan',
        attempt: retries + 1,
        timestamp: Date.now(),
        bot_status: botStatus
      }, {
        timeout: 15000,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'WhatsApp-Bot/2.0'
        }
      });
      
      if (response.status === 200) {
        console.log("✅ [QR] QR code successfully sent to backend");
        return true;
      }
      
    } catch (error) {
      retries++;
      console.error(`❌ [QR] Send failed (${retries}/${maxRetries}):`, error.message);
      
      if (retries < maxRetries) {
        const delay = retries * 2000; // Exponential backoff
        console.log(`⏳ [QR] Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  console.error("❌ [QR] All QR send attempts failed - continuing anyway");
  return false;
}

// Enhanced function to notify Flask backend
async function notifyBackendReady(maxRetries = 3) {
  let retries = 0;
  
  while (retries < maxRetries) {
    try {
      console.log(`📤 [READY] Notifying backend (attempt ${retries + 1}/${maxRetries})`);
      
      // Safely get bot info
      let botNumber = "Unknown";
      let waVersion = "Unknown";
      let clientInfo = {};
      
      try {
        botNumber = client.info?.wid?.user || client.info?.me?.user || "Unknown";
        waVersion = client.info?.phone?.wa_version || client.info?.version || "Unknown";
        clientInfo = {
          hasInfo: !!client.info,
          hasPhone: !!(client.info?.phone),
          hasVersion: !!(client.info?.phone?.wa_version || client.info?.version),
          hasWid: !!(client.info?.wid)
        };
      } catch (infoError) {
        console.warn("⚠️ [READY] Could not get client info:", infoError.message);
      }
      
      const response = await axios.post('http://localhost:5000/bot-ready', {
        status: 'ready',
        bot_number: botNumber,
        timestamp: Date.now(),
        version: waVersion,
        client_info: clientInfo,
        bot_status: botStatus,
        startup_time: Date.now() - botStatus.startTime
      }, {
        timeout: 15000,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'WhatsApp-Bot/2.0'
        }
      });
      
      if (response.status === 200) {
        console.log("✅ [READY] Backend notified successfully");
        return true;
      }
      
    } catch (error) {
      retries++;
      console.error(`❌ [READY] Notification failed (${retries}/${maxRetries}):`, error.message);
      
      if (retries < maxRetries) {
        const delay = retries * 2000;
        console.log(`⏳ [READY] Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  console.error("❌ [READY] All notification attempts failed");
  return false;
}

// Error tracking function
function addError(errorMsg) {
  botStatus.errors.push({
    message: errorMsg,
    timestamp: Date.now(),
    formatted: new Date().toISOString()
  });
  
  // Keep only last 10 errors
  if (botStatus.errors.length > MAX_ERRORS) {
    botStatus.errors = botStatus.errors.slice(-MAX_ERRORS);
  }
}

// Enhanced message handler with comprehensive error handling
client.on("message", async (message) => {
  // Skip if bot is not ready
  if (!botStatus.ready) {
    console.log("⏭️ [SKIP] Message skipped - bot not ready");
    return;
  }

  // Rate limiting
  const now = Date.now();
  if (now - lastApiCall < API_COOLDOWN) {
    console.log("⏭️ [SKIP] Message skipped - rate limited");
    return;
  }

  try {
    // Enhanced message validation
    if (!message || !message.body) {
      console.log("⏭️ [SKIP] Invalid message object");
      return;
    }

    // Get mentions and quoted message with error handling
    let mentions = [];
    let quotedmsg = null;
    
    try {
      mentions = await message.getMentions() || [];
      quotedmsg = await message.getQuotedMessage();
    } catch (mentionError) {
      console.warn("⚠️ [MENTION] Could not get mentions:", mentionError.message);
    }
    
    // Safely get bot number with multiple fallbacks
    let botnumber = "unknown";
    try {
      botnumber = client.info?.wid?._serialized || 
                  client.info?.wid?.user || 
                  client.info?.me?._serialized ||
                  client.info?.me?.user ||
                  "unknown";
    } catch (botNumError) {
      console.warn("⚠️ [BOT_NUM] Could not get bot number:", botNumError.message);
    }

    // Check if bot is mentioned or quoted
    const mention = mentions.some((user) => {
      try {
        const userId = user.id?._serialized || user.id?.user;
        return userId === botnumber || 
               userId === client.info?.wid?.user ||
               userId === client.info?.me?.user;
      } catch (e) {
        return false;
      }
    });
    
    const quote = quotedmsg && quotedmsg.fromMe;
    const isGroupMessage = message.from.includes("@g.us");

    // Only respond in groups when mentioned or quoted
    if (isGroupMessage && !message.fromMe && (mention || quote)) {
      
      lastApiCall = now; // Update rate limit
      botStatus.lastActivity = now;
      botStatus.messagesProcessed++;
      
      console.log("=" .repeat(50));
      console.log("📨 [MESSAGE] New Message Received");
      console.log(`👤 [USER] ${message._data?.notifyName || message.author || "Unknown"}`);
      console.log(`💬 [TEXT] ${message.body?.substring(0, 100)}${message.body?.length > 100 ? '...' : ''}`);
      console.log(`🏷️ [CHAT] ${message.from}`);
      console.log(`🔗 [TYPE] ${mention ? "Mention" : "Quote"}`);
      console.log(`📊 [STATS] Messages processed: ${botStatus.messagesProcessed}`);
      console.log("🔄 [STATUS] Processing...");

      // Send typing indicator with enhanced error handling
      try {
        const chat = await message.getChat();
        if (chat && typeof chat.sendStateTyping === 'function') {
          await chat.sendStateTyping();
          console.log("⌨️ [TYPING] Typing indicator sent");
        }
      } catch (typingError) {
        console.warn("⚠️ [TYPING] Could not send typing indicator:", typingError.message);
      }

      // Clean the message text with better sanitization
      let cleanText = "";
      try {
        cleanText = message.body
          .replace(/@\d+/g, '') // Remove @mentions
          .replace(/\s+/g, ' ') // Replace multiple spaces with single space
          .trim()
          .substring(0, MAX_MESSAGE_LENGTH); // Limit length
      } catch (cleanError) {
        console.error("❌ [CLEAN] Error cleaning message:", cleanError.message);
        cleanText = "Error processing message";
      }

      console.log(`🧹 [CLEAN] Cleaned text: "${cleanText}"`);
      console.log("📤 [REQUEST] Sending to Flask backend...");

      // Make request to Flask backend with enhanced error handling
      let response;
      try {
        const requestData = { 
          text: cleanText,
          user: message._data?.notifyName || message.author || "Unknown",
          chat_id: message.from,
          timestamp: now,
          message_id: message.id?._serialized || "unknown",
          is_group: isGroupMessage
        };

        console.log("📋 [REQUEST] Request data prepared");

        response = await axios.post(
          "http://localhost:5000/reply",
          requestData,
          {
            responseType: "arraybuffer",
            headers: {
              "Content-Type": "application/json",
              "User-Agent": "WhatsApp-Bot/2.0"
            },
            timeout: 120000, // 2 minute timeout
            maxRedirects: 0,
            validateStatus: function (status) {
              return status < 500; // Don't throw for 4xx errors
            }
          }
        );
      } catch (requestError) {
        console.error("❌ [REQUEST] Backend request failed:", requestError.message);
        addError("Backend request failed: " + requestError.message);
        
        // Send fallback message
        try {
          await message.reply("Sorry, I'm having technical difficulties right now 🤖 Please try again in a moment!");
          console.log("🔄 [FALLBACK] Sent fallback message");
        } catch (fallbackError) {
          console.error("❌ [FALLBACK] Could not send fallback message:", fallbackError.message);
        }
        console.log("=" .repeat(50));
        return;
      }

      console.log(`📥 [RESPONSE] Backend responded with status: ${response.status}`);
      
      if (response.status !== 200) {
        console.error(`❌ [RESPONSE] Backend error: ${response.status}`);
        addError(`Backend error: ${response.status}`);
        try {
          await message.reply("Something went wrong on my end 😅 Please try again!");
        } catch (errorReplyError) {
          console.error("❌ [ERROR_REPLY] Could not send error reply:", errorReplyError.message);
        }
        console.log("=" .repeat(50));
        return;
      }

      const contentType = response.headers["content-type"] || response.headers["Content-Type"] || "";
      console.log(`📋 [RESPONSE] Content-Type: ${contentType}`);

      // Handle image response with enhanced error handling
      if (contentType.startsWith("image/")) {
        console.log("🖼️ [IMAGE] Processing image response...");
        
        try {
          if (!response.data || response.data.length === 0) {
            throw new Error("Empty image data received");
          }

          const timestamp = Date.now();
          const imagePath = path.join(__dirname, `generated_image_${timestamp}.png`);
          
          console.log(`📏 [IMAGE] Image size: ${Math.round(response.data.length / 1024)}KB`);
          
          // Save image with better error handling
          fs.writeFileSync(imagePath, response.data);
          console.log(`💾 [IMAGE] Saved to: ${imagePath}`);

          // Verify file was created and is valid
          if (!fs.existsSync(imagePath) || fs.statSync(imagePath).size === 0) {
            throw new Error("Failed to save image file");
          }

          // Create and send media with timeout
          const media = MessageMedia.fromFilePath(imagePath);
          if (!media) {
            throw new Error("Failed to create media object");
          }

          await Promise.race([
            message.reply(media),
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error("Image send timeout")), 30000)
            )
          ]);

          console.log("✅ [IMAGE] Image sent successfully!");
          
          // Clean up with delay to ensure message is sent
          setTimeout(() => {
            try {
              if (fs.existsSync(imagePath)) {
                fs.unlinkSync(imagePath);
                console.log("🗑️ [CLEANUP] Temporary image file deleted");
              }
            } catch (cleanupError) {
              console.warn("⚠️ [CLEANUP] Could not delete temp file:", cleanupError.message);
            }
          }, 5000);
          
        } catch (imageError) {
          console.error("❌ [IMAGE] Error processing image:", imageError.message);
          addError("Image processing failed: " + imageError.message);
          try {
            await message.reply("Generated an image but couldn't send it 📷 Please try again!");
          } catch (imageErrorReplyError) {
            console.error("❌ [IMAGE_ERROR_REPLY] Could not send image error reply:", imageErrorReplyError.message);
          }
        }
      } 
      // Handle text response with enhanced processing
      else {
        console.log("💬 [TEXT] Processing text response...");
        
        let responseText = "";
        try {
          // Parse response based on content type with better error handling
          if (Buffer.isBuffer(response.data)) {
            const jsonString = response.data.toString("utf8");
            const jsonResponse = JSON.parse(jsonString);
            responseText = jsonResponse.reply || jsonResponse.message || "No response available.";
          } else if (typeof response.data === "object" && response.data.reply) {
            responseText = response.data.reply;
          } else if (typeof response.data === "string") {
            responseText = response.data;
          } else {
            responseText = "Unexpected response format.";
          }

          // Validate and sanitize response text
          if (responseText && typeof responseText === "string") {
            responseText = responseText.trim();
            
            if (responseText.length === 0) {
              throw new Error("Empty response text");
            }
            
            // Ensure response is not too long (WhatsApp limit)
            if (responseText.length > MAX_MESSAGE_LENGTH) {
              responseText = responseText.substring(0, MAX_MESSAGE_LENGTH - 20) + "... (truncated)";
              console.log("⚠️ [TEXT] Response truncated due to length");
            }
            
            await message.reply(responseText);
            console.log(`✅ [REPLY] Sent: "${responseText.substring(0, 100)}${responseText.length > 100 ? '...' : ''}"`);
          } else {
            throw new Error("Invalid or empty response text");
          }
          
        } catch (parseError) {
          console.error("❌ [TEXT] Error parsing response:", parseError.message);
          addError("Text parsing failed: " + parseError.message);
          try {
            await message.reply("Got a response but couldn't understand it 🤔 Please try again!");
          } catch (parseErrorReplyError) {
            console.error("❌ [PARSE_ERROR_REPLY] Could not send parse error reply:", parseErrorReplyError.message);
          }
        }
      }
      
      console.log("=" .repeat(50));
    } 
    // Log skipped messages for debugging (less verbose)
    else if (isGroupMessage && !message.fromMe) {
      const preview = message.body ? message.body.substring(0, 30) + "..." : "Media message";
      console.log(`⏭️ [SKIP] Group message (not mentioned): ${preview}`);
    }
  } 
  catch (error) {
    console.error("❌ [ERROR] Message processing failed:", error.message);
    console.error("📍 [STACK] Stack trace:", error.stack);
    addError("Message processing failed: " + error.message);
    
    // Only reply if we have a valid message object
    try {
      if (message && typeof message.reply === 'function' && message.from.includes("@g.us")) {
        await message.reply("Sorry, I encountered an error while processing your message 😔 Please try again!");
        console.log("📨 [ERROR_REPLY] Error message sent to user");
      }
    } catch (replyError) {
      console.error("❌ [ERROR_REPLY] Could not send error message:", replyError.message);
    }
  }
});

// Enhanced health check function
async function healthCheck() {
  const memUsage = process.memoryUsage();
  const status = {
    ready: botStatus.ready,
    authenticated: botStatus.authenticated,
    lastActivity: botStatus.lastActivity,
    uptime: process.uptime(),
    messagesProcessed: botStatus.messagesProcessed,
    connectionAttempts: botStatus.connectionAttempts,
    errors: botStatus.errors.length,
    recentErrors: botStatus.errors.slice(-3),
    memory: {
      rss: Math.round(memUsage.rss / 1024 / 1024) + " MB",
      heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024) + " MB",
      external: Math.round(memUsage.external / 1024 / 1024) + " MB"
    },
    clientInfo: {
      hasInfo: !!client.info,
      botNumber: client.info?.wid?.user || client.info?.me?.user || "Unknown"
    },
    performance: {
      avgResponseTime: "N/A", // Could be implemented
      lastMessageTime: botStatus.lastActivity
    }
  };
  
  console.log("💚 [HEALTH] Bot status check:");
  console.log(`   Status: ${status.ready ? '✅ Ready' : '❌ Not Ready'}`);
  console.log(`   Uptime: ${Math.round(status.uptime / 60)} minutes`);
  console.log(`   Messages: ${status.messagesProcessed}`);
  console.log(`   Memory: ${status.memory.heapUsed}`);
  console.log(`   Errors: ${status.errors}`);
  
  return status;
}

// Periodic health check with configurable interval
const HEALTH_CHECK_INTERVAL = 300000; // 5 minutes
setInterval(healthCheck, HEALTH_CHECK_INTERVAL);

// Enhanced graceful shutdown with cleanup
async function gracefulShutdown(signal) {
  console.log(`🛑 [SHUTDOWN] Received ${signal}. Initiating graceful shutdown...`);
  
  try {
    // Stop accepting new messages
    botStatus.ready = false;
    
    console.log("📊 [SHUTDOWN] Final statistics:");
    console.log(`   Messages processed: ${botStatus.messagesProcessed}`);
    console.log(`   Uptime: ${Math.round(process.uptime() / 60)} minutes`);
    console.log(`   Errors encountered: ${botStatus.errors.length}`);
    
    if (client) {
      console.log("🔌 [SHUTDOWN] Destroying WhatsApp client...");
      await Promise.race([
        client.destroy(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error("Client destroy timeout")), 10000)
        )
      ]);
      console.log("✅ [SHUTDOWN] WhatsApp client destroyed successfully");
    }
  } catch (error) {
    console.error("❌ [SHUTDOWN] Error during shutdown:", error.message);
  }
  
  // Clean up any temporary files
  try {
    const files = fs.readdirSync(__dirname);
    const imageFiles = files.filter(file => file.startsWith('generated_image_'));
    
    for (const file of imageFiles) {
      fs.unlinkSync(path.join(__dirname, file));
    }
    
    if (imageFiles.length > 0) {
      console.log(`🗑️ [SHUTDOWN] Cleaned up ${imageFiles.length} temporary files`);
    }
  } catch (cleanupError) {
    console.warn("⚠️ [SHUTDOWN] Error during file cleanup:", cleanupError.message);
  }
  
  console.log("👋 [SHUTDOWN] Bot shutdown complete");
  process.exit(0);
}

// Register enhanced shutdown handlers
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Enhanced error handling for unhandled promises and exceptions
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ [ERROR] Unhandled Promise Rejection at:', promise);
  console.error('❌ [ERROR] Reason:', reason);
  addError("Unhandled promise rejection: " + String(reason));
  
  // Don't exit on unhandled promise rejections for better stability
  console.log('⚠️ [ERROR] Continuing execution despite unhandled promise rejection');
});

process.on('uncaughtException', (error) => {
  console.error('❌ [ERROR] Uncaught Exception:', error.message);
  console.error('📍 [ERROR] Stack:', error.stack);
  addError("Uncaught exception: " + error.message);
  
  // For uncaught exceptions, we should exit as the application state is uncertain
  console.log('🛑 [ERROR] Exiting due to uncaught exception in 2 seconds...');
  setTimeout(() => {
    process.exit(1);
  }, 2000);
});

// Initialize client with enhanced retry mechanism
console.log("🚀 [INIT] Initializing WhatsApp Client...");
console.log("⚠️ [INIT] Make sure WhatsApp Web is closed in all browsers");
console.log("📱 [INIT] Have your phone ready to scan the QR code");

let initRetryCount = 0;
const MAX_INIT_RETRIES = 3;
const INIT_RETRY_DELAY = 15000; // 15 seconds

async function initializeWithRetry() {
  try {
    initRetryCount++;
    console.log(`🔄 [INIT] Initialization attempt ${initRetryCount}/${MAX_INIT_RETRIES}`);
    console.log("⏳ [INIT] This may take up to 2 minutes...");
    
    // Set a timeout for initialization
    await Promise.race([
      client.initialize(),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error("Initialization timeout after 2 minutes")), 120000)
      )
    ]);
    
    console.log("🎉 [INIT] Client initialized successfully!");
    
  } catch (error) {
    console.error(`❌ [INIT] Attempt ${initRetryCount} failed:`, error.message);
    addError("Initialization failed: " + error.message);
    
    if (initRetryCount < MAX_INIT_RETRIES) {
      console.log(`⏳ [INIT] Retrying in ${INIT_RETRY_DELAY/1000} seconds... (${initRetryCount}/${MAX_INIT_RETRIES})`);
      console.log("💡 [INIT] If this keeps failing, try:");
      console.log("   - Closing WhatsApp Web in ALL browser tabs");
      console.log("   - Restarting your router/internet connection");
      console.log("   - Running: npm install --force");
      
      setTimeout(initializeWithRetry, INIT_RETRY_DELAY);
    } else {
      console.error("❌ [INIT] Max initialization retries reached. Exiting...");
      console.error("🔧 [HELP] Troubleshooting steps:");
      console.error("   1. Ensure WhatsApp Web is closed in ALL browsers");
      console.error("   2. Check your internet connection stability");
      console.error("   3. Run: npm install --force");
      console.error("   4. Try clearing browser cache for web.whatsapp.com");
      console.error("   5. Restart your system if issues persist");
      console.error("   6. Check if your system has enough free RAM");
      
      // Save error log before exiting
      const errorLog = {
        timestamp: new Date().toISOString(),
        errors: botStatus.errors,
        finalError: error.message,
        retryCount: initRetryCount,
        systemInfo: {
          nodeVersion: process.version,
          platform: process.platform,
          memory: process.memoryUsage()
        }
      };
      
      try {
        fs.writeFileSync(path.join(__dirname, 'error_log.json'), JSON.stringify(errorLog, null, 2));
        console.log("📝 [INIT] Error log saved to error_log.json");
      } catch (logError) {
        console.error("❌ [INIT] Could not save error log:", logError.message);
      }
      
      process.exit(1);
    }
  }
}

// Check dependencies before starting
console.log("🔍 [CHECK] Verifying dependencies...");

async function checkDependencies() {
  const requiredPackages = [
    'whatsapp-web.js',
    'axios',
    'fs',
    'path'
  ];
  
  const missingPackages = [];
  
  for (const pkg of requiredPackages) {
    try {
      if (pkg === 'fs' || pkg === 'path') {
        // These are built-in Node.js modules
        continue;
      }
      await import(pkg);
      console.log(`✅ [CHECK] ${pkg} - OK`);
    } catch (error) {
      console.error(`❌ [CHECK] ${pkg} - MISSING`);
      missingPackages.push(pkg);
    }
  }
  
  if (missingPackages.length > 0) {
    console.error("❌ [CHECK] Missing required packages:", missingPackages.join(', '));
    console.error("🔧 [FIX] Run the following command to install missing packages:");
    console.error(`   npm install ${missingPackages.join(' ')}`);
    console.error("📝 [INFO] Or run: npm install --force to reinstall all dependencies");
    process.exit(1);
  }
  
  console.log("✅ [CHECK] All dependencies verified successfully!");
  return true;
}

// Enhanced startup sequence
async function startBot() {
  try {
    console.log("🎬 [START] Enhanced WhatsApp AI Bot Starting...");
    console.log(`🕒 [START] Start time: ${new Date().toISOString()}`);
    console.log(`🖥️ [START] Node.js version: ${process.version}`);
    console.log(`💾 [START] Platform: ${process.platform}`);
    console.log(`🆔 [START] Process ID: ${process.pid}`);
    
    // Check dependencies first
    await checkDependencies();
    
    // Wait a moment for Flask server to be ready
    console.log("⏳ [WAIT] Waiting 3 seconds for Flask server to be ready...");
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    console.log("🚀 [INIT] Starting WhatsApp client initialization...");
    await initializeWithRetry();
    
  } catch (startupError) {
    console.error("❌ [START] Fatal startup error:", startupError.message);
    addError("Fatal startup error: " + startupError.message);
    process.exit(1);
  }
}

// Performance monitoring
let performanceMetrics = {
  messageCount: 0,
  totalResponseTime: 0,
  averageResponseTime: 0,
  lastMetricsReset: Date.now()
};

function updatePerformanceMetrics(responseTime) {
  performanceMetrics.messageCount++;
  performanceMetrics.totalResponseTime += responseTime;
  performanceMetrics.averageResponseTime = 
    performanceMetrics.totalResponseTime / performanceMetrics.messageCount;
  
  // Reset metrics every hour
  if (Date.now() - performanceMetrics.lastMetricsReset > 3600000) {
    performanceMetrics = {
      messageCount: 0,
      totalResponseTime: 0,
      averageResponseTime: 0,
      lastMetricsReset: Date.now()
    };
  }
}

// Memory monitoring
function monitorMemoryUsage() {
  const usage = process.memoryUsage();
  const memoryLimit = 512 * 1024 * 1024; // 512MB limit
  
  if (usage.heapUsed > memoryLimit) {
    console.warn("⚠️ [MEMORY] High memory usage detected:", Math.round(usage.heapUsed / 1024 / 1024), "MB");
    
    // Force garbage collection if available
    if (global.gc) {
      console.log("🗑️ [MEMORY] Running garbage collection...");
      global.gc();
    }
  }
}

// Monitor memory every 5 minutes
setInterval(monitorMemoryUsage, 300000);

// Crash recovery mechanism
process.on('exit', (code) => {
  console.log(`🚪 [EXIT] Process exiting with code: ${code}`);
  console.log(`📊 [EXIT] Final stats: ${botStatus.messagesProcessed} messages processed`);
  console.log(`⏱️ [EXIT] Total uptime: ${Math.round(process.uptime() / 60)} minutes`);
  
  // Log exit reason for debugging
  const exitLog = {
    timestamp: new Date().toISOString(),
    exitCode: code,
    uptime: process.uptime(),
    messagesProcessed: botStatus.messagesProcessed,
    errors: botStatus.errors.slice(-5), // Last 5 errors
    performance: performanceMetrics
  };
  
  try {
    fs.writeFileSync(path.join(__dirname, 'exit_log.json'), JSON.stringify(exitLog, null, 2));
  } catch (logError) {
    console.error("❌ [EXIT] Could not save exit log:", logError.message);
  }
});

// Start the bot
startBot().catch(error => {
  console.error("❌ [FATAL] Failed to start bot:", error.message);
  process.exit(1);
});   