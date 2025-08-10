import pkg from 'whatsapp-web.js';
const { Client, LocalAuth, MessageMedia } = pkg;
import axios from "axios";
import fs from "fs";
import path from "path";
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Enhanced client configuration with better stability
const client = new Client({
  authStrategy: new LocalAuth({ 
    clientId: "whatsapp-ai-bot",
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
      "--disable-renderer-backgrounding"
    ],
    timeout: 90000, // Increased timeout
  },
  webVersionCache: {
    type: 'remote',
    remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
  }
});

// Bot status tracking
let botStatus = {
  authenticated: false,
  ready: false,
  qrCode: null,
  lastActivity: Date.now(),
  connectionAttempts: 0
};

// Rate limiting for API calls
let lastApiCall = 0;
const API_COOLDOWN = 2000; // 2 seconds between API calls

console.log("🤖 Enhanced WhatsApp AI Bot Starting...");
console.log("📋 Features: AI Text + Image Generation + Hindi Support");

client.on("qr", async (qr) => {
  console.log("📱 QR RECEIVED - Length:", qr.length);
  console.log("🔗 QR Preview:", qr.substring(0, 50) + "...");
  
  botStatus.qrCode = qr;
  botStatus.connectionAttempts++;
  
  console.log(`[QR] Connection attempt #${botStatus.connectionAttempts}`);
  console.log("[QR] Please scan this QR code with WhatsApp on your phone");
  console.log("[QR] Go to: WhatsApp → Settings → Linked Devices → Link a Device");
  
  // Send QR to Flask backend with retry
  await sendQRToBackend(qr, 3);
});

client.on("ready", async () => {
  console.log("🎉 [SUCCESS] WhatsApp Client is Ready!");
  
  // Safely access client info with fallbacks
  const botNumber = client.info?.wid?.user || "Unknown";
  const waVersion = client.info?.phone?.wa_version || client.info?.version || "Unknown";
  
  console.log("📞 Bot Number:", botNumber);
  console.log("📱 WhatsApp Version:", waVersion);
  console.log("⚡ Status: Bot is now active and listening for mentions");
  
  botStatus.ready = true;
  botStatus.qrCode = null;
  botStatus.authenticated = true;
  botStatus.lastActivity = Date.now();
  
  // Notify Flask backend
  await notifyBackendReady(3);
  
  console.log("✅ Bot initialization complete - Ready to respond to messages!");
});

client.on("authenticated", () => {
  console.log("🔐 [AUTH] Authentication successful!");
  botStatus.authenticated = true;
});

client.on("auth_failure", (msg) => {
  console.error("❌ [AUTH_FAIL] Authentication failed:", msg);
  botStatus.authenticated = false;
  botStatus.ready = false;
  
  // Reset connection attempts after auth failure
  if (botStatus.connectionAttempts >= 3) {
    console.log("🔄 [RESET] Too many failed attempts, resetting...");
    setTimeout(() => {
      process.exit(1); // Let the process manager restart us
    }, 5000);
  }
});

client.on("disconnected", (reason) => {
  console.log("🔌 [DISCONNECT] Bot disconnected. Reason:", reason);
  botStatus.ready = false;
  botStatus.authenticated = false;
  
  // Attempt to reconnect
  console.log("🔄 [RECONNECT] Attempting to reconnect...");
});

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
        timestamp: Date.now()
      }, {
        timeout: 15000,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'WhatsApp-Bot/1.0'
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
      const botNumber = client.info?.wid?.user || "Unknown";
      const waVersion = client.info?.phone?.wa_version || client.info?.version || "Unknown";
      
      const response = await axios.post('http://localhost:5000/bot-ready', {
        status: 'ready',
        bot_number: botNumber,
        timestamp: Date.now(),
        version: waVersion,
        client_info: {
          hasInfo: !!client.info,
          hasPhone: !!(client.info?.phone),
          hasVersion: !!(client.info?.phone?.wa_version || client.info?.version)
        }
      }, {
        timeout: 15000,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'WhatsApp-Bot/1.0'
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

// Enhanced message handler with better error handling
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
    // Get mentions and quoted message
    const mentions = await message.getMentions();
    const quotedmsg = await message.getQuotedMessage();
    
    // Safely get bot number
    const botnumber = client.info?.wid?._serialized || client.info?.wid?.user || "unknown";

    // Check if bot is mentioned or quoted
    const mention = mentions.some((user) => {
      const userId = user.id?._serialized || user.id?.user;
      return userId === botnumber || userId === client.info?.wid?.user;
    });
    const quote = quotedmsg && quotedmsg.fromMe;
    const isGroupMessage = message.from.includes("@g.us");

    // Only respond in groups when mentioned or quoted
    if (isGroupMessage && !message.fromMe && (mention || quote)) {
      
      lastApiCall = now; // Update rate limit
      botStatus.lastActivity = now;
      
      console.log("=" .repeat(50));
      console.log("📨 [MESSAGE] New Message Received");
      console.log(`👤 [USER] ${message._data.notifyName || message.author || "Unknown"}`);
      console.log(`💬 [TEXT] ${message.body}`);
      console.log(`🏷️ [CHAT] ${message.from}`);
      console.log(`🔗 [TYPE] ${mention ? "Mention" : "Quote"}`);
      console.log("🔄 [STATUS] Processing...");

      // Send typing indicator with error handling
      try {
        const chat = await message.getChat();
        if (chat && typeof chat.sendStateTyping === 'function') {
          await chat.sendStateTyping();
          console.log("⌨️ [TYPING] Typing indicator sent");
        }
      } catch (typingError) {
        console.warn("⚠️ [TYPING] Could not send typing indicator:", typingError.message);
      }

      // Clean the message text (remove mentions, extra spaces)
      let cleanText = message.body
        .replace(/@\d+/g, '') // Remove @mentions
        .replace(/\s+/g, ' ') // Replace multiple spaces with single space
        .trim();

      console.log(`🧹 [CLEAN] Cleaned text: "${cleanText}"`);
      console.log("📤 [REQUEST] Sending to Flask backend...");

      // Make request to Flask backend with enhanced error handling
      let response;
      try {
        response = await axios.post(
          "http://localhost:5000/reply",
          { 
            text: cleanText,
            user: message._data.notifyName || "Unknown",
            chat_id: message.from,
            timestamp: now
          },
          {
            responseType: "arraybuffer",
            headers: {
              "Content-Type": "application/json",
              "User-Agent": "WhatsApp-Bot/1.0"
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
        
        // Send fallback message
        await message.reply("Sorry, I'm having technical difficulties right now 🤖 Please try again in a moment!");
        console.log("🔄 [FALLBACK] Sent fallback message");
        console.log("=" .repeat(50));
        return;
      }

      console.log(`📥 [RESPONSE] Backend responded with status: ${response.status}`);
      
      if (response.status !== 200) {
        console.error(`❌ [RESPONSE] Backend error: ${response.status}`);
        await message.reply("Something went wrong on my end 😅 Please try again!");
        console.log("=" .repeat(50));
        return;
      }

      const contentType = response.headers["content-type"] || response.headers["Content-Type"] || "";
      console.log(`📋 [RESPONSE] Content-Type: ${contentType}`);

      // Handle image response
      if (contentType.startsWith("image/")) {
        console.log("🖼️ [IMAGE] Processing image response...");
        
        try {
          const timestamp = Date.now();
          const imagePath = path.join(__dirname, `generated_image_${timestamp}.png`);
          
          // Save image with better error handling
          fs.writeFileSync(imagePath, response.data);
          console.log(`💾 [IMAGE] Saved to: ${imagePath}`);
          console.log(`📏 [IMAGE] Size: ${Math.round(response.data.length / 1024)}KB`);

          // Create and send media
          const media = MessageMedia.fromFilePath(imagePath);
          await message.reply(media);
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
          await message.reply("Generated an image but couldn't send it 📷 Please try again!");
        }
      } 
      // Handle text response
      else {
        console.log("💬 [TEXT] Processing text response...");
        
        let responseText;
        try {
          // Parse response based on content type
          if (Buffer.isBuffer(response.data)) {
            const jsonResponse = JSON.parse(response.data.toString("utf8"));
            responseText = jsonResponse.reply || jsonResponse.message || "No response available.";
          } else if (typeof response.data === "object" && response.data.reply) {
            responseText = response.data.reply;
          } else {
            responseText = "Unexpected response format.";
          }

          // Validate response text
          if (responseText && typeof responseText === "string" && responseText.trim()) {
            // Ensure response is not too long (WhatsApp limit)
            if (responseText.length > 4000) {
              responseText = responseText.substring(0, 3990) + "... (truncated)";
            }
            
            await message.reply(responseText);
            console.log(`✅ [REPLY] Sent: "${responseText.substring(0, 100)}${responseText.length > 100 ? '...' : ''}"`);
          } else {
            await message.reply("I couldn't generate a proper response 😅 Try asking something else!");
            console.log("⚠️ [REPLY] Empty or invalid response text");
          }
          
        } catch (parseError) {
          console.error("❌ [TEXT] Error parsing response:", parseError.message);
          await message.reply("Got a response but couldn't understand it 🤔 Please try again!");
        }
      }
      
      console.log("=" .repeat(50));
    } 
    // Log skipped messages for debugging (but less verbose)
    else if (isGroupMessage && !message.fromMe) {
      const preview = message.body ? message.body.substring(0, 30) + "..." : "Media message";
      console.log(`⏭️ [SKIP] Group message (not mentioned): ${preview}`);
    }
  } 
  catch (error) {
    console.error("❌ [ERROR] Message processing failed:", error.message);
    console.error("📍 [STACK] Stack trace:", error.stack);
    
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

// Health check function
async function healthCheck() {
  const status = {
    ready: botStatus.ready,
    authenticated: botStatus.authenticated,
    lastActivity: botStatus.lastActivity,
    uptime: process.uptime(),
    memoryUsage: process.memoryUsage(),
    clientInfo: {
      hasInfo: !!client.info,
      botNumber: client.info?.wid?.user || "Unknown"
    }
  };
  
  console.log("💚 [HEALTH] Bot status check:", JSON.stringify(status, null, 2));
  return status;
}

// Periodic health check
setInterval(healthCheck, 300000); // Every 5 minutes

// Enhanced graceful shutdown
async function gracefulShutdown(signal) {
  console.log(`🛑 [SHUTDOWN] Received ${signal}. Initiating graceful shutdown...`);
  
  try {
    if (client) {
      console.log("🔌 [SHUTDOWN] Destroying WhatsApp client...");
      await client.destroy();
      console.log("✅ [SHUTDOWN] WhatsApp client destroyed successfully");
    }
  } catch (error) {
    console.error("❌ [SHUTDOWN] Error destroying client:", error.message);
  }
  
  console.log("👋 [SHUTDOWN] Bot shutdown complete");
  process.exit(0);
}

// Register shutdown handlers
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Enhanced error handling for unhandled promises and exceptions
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ [ERROR] Unhandled Promise Rejection at:', promise);
  console.error('❌ [ERROR] Reason:', reason);
  
  // Don't exit on unhandled promise rejections for better stability
  console.log('⚠️ [ERROR] Continuing execution despite unhandled promise rejection');
});

process.on('uncaughtException', (error) => {
  console.error('❌ [ERROR] Uncaught Exception:', error.message);
  console.error('📍 [ERROR] Stack:', error.stack);
  
  // For uncaught exceptions, we should exit as the application state is uncertain
  console.log('🛑 [ERROR] Exiting due to uncaught exception');
  setTimeout(() => {
    process.exit(1);
  }, 1000);
});

// Initialize client with enhanced retry mechanism
console.log("🚀 [INIT] Initializing WhatsApp Client...");
console.log("⚠️ [INIT] Make sure WhatsApp Web is closed in all browsers");
console.log("📱 [INIT] Have your phone ready to scan the QR code");

let initRetryCount = 0;
const MAX_INIT_RETRIES = 3;
const INIT_RETRY_DELAY = 10000; // 10 seconds

async function initializeWithRetry() {
  try {
    initRetryCount++;
    console.log(`🔄 [INIT] Initialization attempt ${initRetryCount}/${MAX_INIT_RETRIES}`);
    console.log("⏳ [INIT] This may take up to 90 seconds...");
    
    await client.initialize();
    console.log("🎉 [INIT] Client initialized successfully!");
    
  } catch (error) {
    console.error(`❌ [INIT] Attempt ${initRetryCount} failed:`, error.message);
    
    if (initRetryCount < MAX_INIT_RETRIES) {
      console.log(`⏳ [INIT] Retrying in ${INIT_RETRY_DELAY/1000} seconds... (${initRetryCount}/${MAX_INIT_RETRIES})`);
      setTimeout(initializeWithRetry, INIT_RETRY_DELAY);
    } else {
      console.error("❌ [INIT] Max initialization retries reached. Exiting...");
      console.error("🔧 [HELP] Troubleshooting steps:");
      console.error("   1. Ensure WhatsApp Web is closed in all browsers");
      console.error("   2. Check your internet connection");
      console.error("   3. Try clearing WhatsApp Web cache");
      console.error("   4. Restart your router/network");
      console.error("   5. Try running the bot from a different network");
      
      process.exit(1);
    }
  }
}

// Add startup delay and begin initialization
console.log("⏳ [WAIT] Waiting 3 seconds for Flask server to be ready...");
setTimeout(() => {
  console.log("🎬 [START] Starting initialization process...");
  initializeWithRetry();
}, 3000);