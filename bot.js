import qrcode from "qrcode-terminal";
import pkg from 'whatsapp-web.js';
const { Client, LocalAuth, MessageMedia } = pkg;
import axios from "axios";
import fs from "fs";
import path from "path";

const client = new Client({
  authStrategy: new LocalAuth({ clientId: "my-whatsapp-bot" }),
  puppeteer: {
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  },
});

client.on("qr", (qr) => {
  qrcode.generate(qr, { small: true });
  console.log("QR RECEIVED", qr);
});

client.on("ready", () => {
  console.log("✅ Client is ready!");
  console.log("🤖 Bot is using number:", client.info.wid.user);
});

client.on("message", async (message) => {
  const mentions = await message.getMentions();
  const quotedmsg = await message.getQuotedMessage();
  const botnumber = client.info.wid._serialized;

  const mention = mentions.some((user) => user.id?._serialized === botnumber);
  const quote = quotedmsg && quotedmsg.fromMe;

  try {
    if (
      message.from.includes("@g.us") &&
      !message.fromMe &&
      (mention || quote)
    ) {
      console.log("👤 User:", message._data.notifyName || message.author);
      console.log("📨 User Message:", message.body);

      const res = await axios.post(
        "http://localhost:5000/reply",
        { text: message.body },
        {
          responseType: "arraybuffer",
          headers: {
            "Content-Type": "application/json",
          },
          timeout: 130000, // 130 second timeout
        }
      );

      const contentType =
        res.headers["content-type"] || res.headers["Content-Type"] || "";

      if (contentType.startsWith("image/")) {
        const imagePath = path.join(__dirname, `response_${Date.now()}.png`);
        fs.writeFileSync(imagePath, res.data);

        const media = MessageMedia.fromFilePath(imagePath);
        await message.reply(media);
        console.log("🖼️ Image sent to WhatsApp group.");
        fs.unlinkSync(imagePath);
      } else {
        let responseText;

        if (Buffer.isBuffer(res.data)) {
          const jsonResponse = JSON.parse(res.data.toString("utf8"));
          responseText = jsonResponse.reply || "No reply found.";
        } else if (typeof res.data === "object" && res.data.reply) {
          responseText = res.data.reply;
        } else {
          responseText = "Unexpected response format.";
        }

        if (responseText && typeof responseText === "string") {
          await message.reply(responseText);
          console.log("🤖 Bot replied:", responseText);
        } else {
          await message.reply("⚠️ Couldn't understand the response.");
        }
      }
    }
  } catch (e) {
    console.error("❌ Error processing message:", e.message);
    console.error("Full error:", e);

    try {
      await message.reply(
        "🚫 Sorry, I encountered an error. Please try again later."
      );
    } catch (replyError) {
      console.error("❌ Error sending error message:", replyError);
    }
  }
});

client.initialize();
