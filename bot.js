const qrcode = require('qrcode-terminal');
const { Client, LocalAuth } = require('whatsapp-web.js');
const axios = require('axios');

const client = new Client({
    authStrategy: new LocalAuth({ clientId: "my-whatsapp-bot" }), // saves login
    puppeteer: {
        headless: true,
        args: ['--no-sandbox','--disable-setuid-sandbox']
    }
});


client.on('qr',(qr)=>{
    qrcode.generate(qr,{small: true})
    console.log('QR RECEIVED', qr);
});


client.on('ready',()=>{
    console.log('Client is ready!');
    console.log('🤖 Bot is using number:', client.info.wid);
});

client.on('message',async message=>{
    const mentions = await message.getMentions();
    const quotedmsg= await message.getQuotedMessage();
    const botnumber = client.info.wid._serialized;

    const mention = mentions.some(user=> user.id.wid._serialized === botnumber);
    const quote = quotedmsg && quotedmsg.fromMe;
    try{
        if(message.from.includes('@g.us') && !message.fromMe && (mention || quote)){
                console.log('📩 New group message:', message.body);
                const res = await axios.post('http://localhost:5000/reply',{
                    text: message.body,
                });
                await message.reply(res.data.reply);
            }
        } catch(e){
            console.error('Error processing message:', e.message);
    };

    
})

client.initialize();