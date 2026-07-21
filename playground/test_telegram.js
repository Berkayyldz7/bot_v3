const dotenv = require("dotenv");
const path = require("path");

// Üst klasördeki .env dosyasını yükle
dotenv.config({
  path: path.resolve(__dirname, "../.env"),
});

async function testTelegram() {
  const token = process.env.TELEGRAM_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  console.log("--- Telegram Test Başlatıldı ---");
  console.log("Okunan Token:", token ? `${token.slice(0, 6)}...` : "BULUNAMADI!");
  console.log("Okunan Chat ID:", chatId ? chatId : "BULUNAMADI!");

  if (!token || !chatId) {
    console.error("❌ HATA: .env dosyasından Telegram bilgileri okunamadı. Lütfen .env dosyanızı kontrol edin.");
    return;
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  try {
    console.log("✈️ Telegram API'sine istek gönderiliyor...");
    
    // Node.js v20 dahili fetch mekanizması
    const response = await globalThis.fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: "🤖 Merhaba! Bu playground içinden gönderilen bir test mesajıdır. Bağlantı başarılı! ✅",
      }),
    });

    const responseData = await response.json();

    if (response.ok && responseData.ok) {
      console.log("🎉 TEBRİKLER! Telegram mesajı başarıyla gönderildi ve telefonunuza ulaşmış olmalı.");
    } else {
      console.error("❌ TELEGRAM BOTA MESAJI İLETEMEDİ!");
      console.error(`Durum Kodu (Status): ${response.status}`);
      console.error("Telegram'dan Dönen Hata Detayı:", JSON.stringify(responseData, null, 2));
    }
  } catch (error) {
    console.error("🚨 BAĞLANTI HATASI: Telegram sunucularına hiç ulaşılamadı!");
    console.error("Hata Mesajı:", error.message);
  }
}

testTelegram();