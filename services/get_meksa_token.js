const fs = require("fs");
const path = require("path");
const fetch = require("node-fetch");
const { exec } = require("child_process");
const dotenv = require("dotenv");

// .env dosyasının yolu
const envPath = path.resolve(__dirname, "..", ".env");
dotenv.config({ path: envPath });

// Yeni token için env değişkenlerini kontrol edelim
const token = process.env.TELEGRAM_TOKEN_AUTH;
const chatId = process.env.TELEGRAM_CHAT_ID; // İsteğe bağlı olarak yetkili sohbet ID'sini kullanabiliriz

if (!token) {
  console.error("HATA: .env dosyasında TELEGRAM_TOKEN_AUTH bulunamadı.");
  console.log("Lütfen BotFather'dan yeni bir bot oluşturun ve token'ı TELEGRAM_TOKEN_AUTH olarak ekleyin.");
  process.exit(1);
}

let lastUpdateId = 0;

async function sendTelegramMessage(text) {
  if (!chatId) return;
  try {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
      }),
    });
  } catch (err) {
    console.error("Telegram mesajı gönderilemedi:", err.message);
  }
}

// .env dosyasındaki spesifik bir anahtarı güncelleyen yardımcı fonksiyon
function updateEnvFile(key, value) {
  try {
    let envContent = fs.readFileSync(envPath, "utf8");
    const regex = new RegExp(`^${key}=.*`, "m");
    
    if (regex.test(envContent)) {
      envContent = envContent.replace(regex, `${key}=${value}`);
    } else {
      envContent += `\n${key}=${value}`;
    }
    
    fs.writeFileSync(envPath, envContent, "utf8");
    console.log(`.env güncellendi: ${key}=${value ? "***" : ""}`);
  } catch (error) {
    console.error(".env dosyası güncellenirken hata oluştu:", error);
  }
}

async function runTakeToken() {
  return new Promise((resolve, reject) => {
    console.log("Token üretme betiği çalıştırılıyor (npm run take_token)...");
    
    exec("npm run take_token", { cwd: path.resolve(__dirname, "..") }, (error, stdout, stderr) => {
      if (error) {
        return reject(new Error(`Çalıştırma hatası: ${error.message}\n${stderr}`));
      }

      // 'Token alindi: D11EB6FD...' formatından token'ı ayıklıyoruz
      const match = stdout.match(/Token alindi:\s*(.+)/);
      if (match && match[1]) {
        resolve(match[1].trim());
      } else {
        reject(new Error(`Token stdout içinden parse edilemedi. Çıktı: ${stdout}`));
      }
    });
  });
}

async function checkTelegramCommands() {
  try {
    const url = `https://api.telegram.org/bot${token}/getUpdates?offset=${lastUpdateId + 1}&timeout=50`;
    const response = await fetch(url);
    const result = await response.json();

    if (result.ok && result.result.length > 0) {
      for (const update of result.result) {
        lastUpdateId = update.update_id;
        
        const messageText = update.message?.text?.trim();
        const incomingChatId = String(update.message?.chat?.id);

        // Eğer chat ID belirlenmişse sadece ondan gelenleri işle
        if (chatId && incomingChatId !== String(chatId)) {
          continue;
        }

        // Eğer sadece 6 rakamdan oluşan bir mesaj geldiyse bunu RUMUZ (2FA) kodu sayalım
        if (messageText && /^\d{6}$/.test(messageText)) {
          console.log(`2FA Kodu algılandı: ${messageText}`);
          await sendTelegramMessage("⏳ 2FA kodu alındı, yeni token üretiliyor...");

          // 1. RUMUZ alanına yaz ve process.env'yi güncelle
          updateEnvFile("RUMUZ", messageText);
          process.env.RUMUZ = messageText;

          try {
            // 2. npm run take_token çalıştır ve token'ı al
            const newToken = await runTakeToken();
            console.log("Yeni Token başarılı bir şekilde alındı.");

            // 3. .env içindeki TOKEN alanını güncelle
            updateEnvFile("TOKEN", newToken);

            // 4. RUMUZ alanını temizle
            updateEnvFile("RUMUZ", "");

            // 5. Başarılı olduğunu bildir
            await sendTelegramMessage("✅ Meksa token başarıyla yenilendi! PM2 Yeniden başlatılıyor...");

            console.log("PM2 yeniden başlatılıyor (pm2 restart all)...");
            
            // 6. PM2'yi yeniden başlat
            exec("pm2 restart all", (err, stdout, stderr) => {
              if (err) {
                console.error("PM2 başlatma hatası:", err.message);
              } else {
                console.log("PM2 başarıyla yeniden başlatıldı.");
              }
            });

          } catch (tokenError) {
            console.error("Token yenileme başarısız:", tokenError.message);
            await sendTelegramMessage(`❌ Token yenileme başarısız oldu:\n${tokenError.message}`);
          }
        }
      }
    }
  } catch (err) {
    if (err.name !== "FetchError" && err.code !== "ECONNRESET") {
      console.error("Telegram getUpdates hatası:", err.message);
    }
  }
}

async function startPolling() {
  console.log("Meksa Token Yöneticisi başlatıldı. Telegram'dan kod bekleniyor...");
  while (true) {
    await checkTelegramCommands();
    // Sunucuyu yormamak adına kısa bir bekleme (fetch timeout=50 olduğu için genelde long polling yapar)
    await new Promise((res) => setTimeout(res, 1000));
  }
}

// Servisi başlat
startPolling();
