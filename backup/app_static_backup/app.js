const { MarketDataService } = require("./services/merket_data_service");
const { FxuSettlementRecorder } = require("./services/fxu_settlement_recorder");
const { SettlementAverage } = require("./services/SettlementAverage");
const { MeksaApi } = require("./services/api_engine");

const fs = require("fs");
const fetch = require("node-fetch"); 

const marketData = new MarketDataService();
const settlementAverage = new SettlementAverage();

const api = new MeksaApi({
  customerNo: process.env.CUSTOMER_NO,
  token: process.env.TOKEN,
});

try {
  const text = fs.readFileSync("./data/fxu-settlements.json", "utf8");
  const rows = JSON.parse(text);
  settlementAverage.init(rows);
} catch (error) {
  settlementAverage.init([]);
}

// GÜVENLİK KİLİTLERİ VE TELEGRAM ALARMLARI
let isTradeRunning = false; 
let localPositionSide = null; 
let isMatriksErrorNotified = false; 
let lastReminderTime = 0; 

// 🚨 TELEGRAM KUMANDA KİLİDİ (Varsayılan olarak bot KAPALI başlar, Telegram'dan açılır)
let isBotEnabledByAdmin = false; 
let lastUpdateId = 0; // Gelen mesajları mükerrer okumamak için sayaç

// TELEGRAM'A MESAJ VE BUTON GÖNDEREN FONKSİYON
async function sendTelegramMessage(text) {
  const token = process.env.TELEGRAM_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;

  try {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    
    // Babanın ekranda göreceği kolay kumanda butonları
    const keyboard = {
      keyboard: [
        [{ text: "🟢 BOTU BAŞLAT (TRADE AKTİF)" }, { text: "🔴 BOTU DURDUR (TRADE PASİF)" }]
      ],
      resize_keyboard: true,
      one_time_keyboard: false
    };

    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        chat_id: chatId, 
        text: `🤖 Meksa Bot: ${text}`,
        reply_markup: keyboard // Butonları mesaja bağlıyoruz
      }),
    });
  } catch (err) {
    console.error("Telegram mesajı gönderilemedi:", err.message);
  }
}

// TELEGRAM'DAN GELEN KOMUTLARI (BUTONLARI) DİNLEYEN FONKSİYON
async function checkTelegramCommands() {
  const token = process.env.TELEGRAM_TOKEN;
  if (!token) return;

  try {
    const url = `https://api.telegram.org/bot${token}/getUpdates?offset=${lastUpdateId + 1}&timeout=0`;
    const response = await fetch(url);
    const result = await response.json();

    if (result.ok && result.result.length > 0) {
      for (const update of result.result) {
        lastUpdateId = update.update_id;

        const messageText = update.message?.text;
        const incomingChatId = String(update.message?.chat?.id);

        // Güvenlik: Sadece .env dosyasındaki Chat ID'den gelen komutları dinle (Yabancılar kontrol edemesin)
        if (incomingChatId !== String(process.env.TELEGRAM_CHAT_ID)) continue;

        if (messageText === "🟢 BOTU BAŞLAT (TRADE AKTİF)" || messageText === "/start") {
          if (!isBotEnabledByAdmin) {
            isBotEnabledByAdmin = true;
            await sendTelegramMessage("✅ SISTEM TETIKLENDI! Algoritmik trade döngüsü şu an AKTİF hale getirildi. Pazar taranıyor...");
          }
        } 
        else if (messageText === "🔴 BOTU DURDUR (TRADE PASİF)") {
          if (isBotEnabledByAdmin) {
            isBotEnabledByAdmin = false;
            await sendTelegramMessage("🛑 SISTEM DURDURULDU! Algoritmik trade döngüsü askıya alındı. Yeni emir gönderilmeyecek.");
          }
        }
      }
    }
  } catch (err) {
    console.error("Telegram komutları okunamadı:", err.message);
  }
}

// MATRİKS SOKET HATALARINI TELEGRAM'A BAĞLAMA OPERASYONU
marketData.onError((errorMessage) => {
  if (!isMatriksErrorNotified) {
    sendTelegramMessage(`🚨 KRİTİK ALARM: Matriks Bağlantısı Sağlanamadı veya Koptu! Arıza Detayı: ${errorMessage}\n⚠️ İşlemler veri gelene kadar askıya alındı. Açık pozisyonunuz varsa manuel takip edin!`);
    isMatriksErrorNotified = true; 
    lastReminderTime = Date.now(); 
  }
});

marketData.onConnect(() => {
  if (isMatriksErrorNotified) {
    sendTelegramMessage(`✅ BİLGİ: Matriks soket bağlantısı başarıyla onarıldı, veri akışı taze. Bot komut bekliyor.`);
    isMatriksErrorNotified = false; 
  }
});

// Matriks canlı veri akışını başlat
marketData.start();

// 5 günlük uzlaşı fiyatlarını kaydeden kaydediciyi başlat
const recorder = new FxuSettlementRecorder(marketData, settlementAverage, {
  intervalMs: 10000,
  outputFile: "./data/fxu-settlements.json",
});
recorder.start();

// Bot sunucuda ilk açıldığında babana butonları gönderir ve onay bekler
sendTelegramMessage("Sunucuda başarıyla ayağa kalktım. Trade işlemini başlatmak için lütfen aşağıdaki yeşil butona basın! 🔌");

// Telegram komutlarını her 1 saniyede bir kontrol et (Kumanda gecikmesin)
setInterval(checkTelegramCommands, 1000);

// ANA STRATEJİ DÖNGÜSÜ (Her 2 saniyede bir döner)
setInterval(async () => {
  // 🟢 KUMANDA KONTROLÜ: Eğer baban Telegram'dan durdurduysa stratejiyi HİÇ ÇALIŞTIRMA
  if (!isBotEnabledByAdmin) {
    return; 
  }

  if (isTradeRunning) {
    console.log("[KİLİT] İçeride bekleyen işlem var, bu tur pas geçildi.");
    return;
  }

  const fxuSnapshot = marketData.getFxuSnapshotWithTime();
  const avg5 = settlementAverage.getAverage5();

  // 1. KORUMA: MATRİKS'TEN VERİ HİÇ GELMİYORSA
  if (!fxuSnapshot || avg5 == null) {
    console.log("FXU veya avg5 verisi henüz hazır değil, bekleniyor...");
    if (!isMatriksErrorNotified) {
      sendTelegramMessage(`🚨 KRİTİK ALARM: Matriks Canlı Veri Akışı Mevcut Değil! Veri bekleniyor...`);
      isMatriksErrorNotified = true;
      lastReminderTime = Date.now();
    } else {
      if (Date.now() - lastReminderTime > 300000) {
        sendTelegramMessage(`⚠️ HATIRLATMA: Matriks veri akışı hala sağlanamadı. Bot beklemede. Lütfen pozisyonlarınızı elinizle kontrol edin!`);
        lastReminderTime = Date.now();
      }
    }
    return;
  }

  // 2. KORUMA: VERİ AKIŞI ZAMAN AŞIMI (BAYAT VERİ) KONTROLÜ
  const maxAgeMs = 10000;
  const isFxuFresh = (Date.now() - fxuSnapshot.receivedAt) < maxAgeMs;

  if (!isFxuFresh) {
    console.log(`[TEHLİKE] Canlı veri akışı bayat! İşlem durduruldu.`);
    if (!isMatriksErrorNotified) {
      sendTelegramMessage(`🚨 KRİTİK ALARM: Matriks Canlı Veri Akışı BAYAT/DONMUŞ durumda! Güvenlik için işlemler askıya alındı.`);
      isMatriksErrorNotified = true;
      lastReminderTime = Date.now();
    } else {
      if (Date.now() - lastReminderTime > 300000) {
        sendTelegramMessage(`⚠️ HATIRLATMA: Matriks veri akışı hala donmuş durumda. Bot beklemede. Lütfen pozisyonlarınızı elinizle kontrol edin!`);
        lastReminderTime = Date.now();
      }
    }
    return;
  }

  const fxuLast = Number(fxuSnapshot.data.last);
  const settlementAverage5 = Number(avg5);

  if (!Number.isFinite(fxuLast) || !Number.isFinite(settlementAverage5)) {
    console.log("FXU last veya avg5 sayısal değil, tur atlandı.");
    return;
  }

  console.log("--- Pazarı İzleme Turu ---");
  console.log("FXU Son Fiyat:", fxuLast);
  console.log("FXU 5 Günlük Uzlaşı Ortalaması:", settlementAverage5);

  isTradeRunning = true;

  try {
    const position = await api.getViopPositionsDetails();
    let realPositionSide = "NONE";

    if (position && position.sozlesmeAdi === process.env.VIOP_SOZLESME) {
      const positionAmount = Number(position.tutar || 0);
      if (positionAmount > 0) realPositionSide = "LONG";
      else if (positionAmount < 0) realPositionSide = "SHORT";
    }

    if (localPositionSide !== null && localPositionSide !== realPositionSide) {
      console.log(`[SENKRONİZASYON] ${localPositionSide} emri iletildi ancak Meksa hala ${realPositionSide} gösteriyor. API güncellemesi bekleniyor...`);
      return; 
    }

    if (localPositionSide !== null && localPositionSide === realPositionSide) {
       console.log(`[SENKRONİZASYON] Borsa sistemi güncellendi. Mevcut Pozisyon: ${realPositionSide}`);
       sendTelegramMessage(`Borsa ile senkronizasyon sağlandı. Güncel Pozisyon: ${realPositionSide} ✅`);
       localPositionSide = null;
    }

    const positionSide = realPositionSide;
    
    if (fxuLast > settlementAverage5) {
      if (positionSide === "NONE") {
        console.log("Sinyal LONG: Pozisyon yok. 1 adet LONG emri gönderiliyor...");
        localPositionSide = "LONG"; 

        await api.placeViopBuyOrder({
          sozlesme: process.env.VIOP_SOZLESME,
          quantity: 1,
          orderType: "PKP",
          duration: "GUN",
          aksamSeansi: 0,
        });
        console.log("-> 1 Adet LONG emir Meksa'ya başarıyla iletildi.");
        sendTelegramMessage(`Sinyal LONG 📈: Pozisyon yoktu, Meksa'ya 1 adet LONG emir iletildi.`);
        
      } else if (positionSide === "SHORT") {
        console.log("Sinyal LONG: Mevcut SHORT pozisyon var. Kapatmak ve LONG açmak için 2 adet LONG emri gönderiliyor...");
        localPositionSide = "LONG"; 

        await api.placeViopBuyOrder({
          sozlesme: process.env.VIOP_SOZLESME,
          quantity: 2,
          orderType: "PKP",
          duration: "GUN",
          aksamSeansi: 0,
        });
        console.log("-> SHORT kapatıldı ve 1 adet LONG pozisyon açıldı.");
        sendTelegramMessage(`Sinyal LONG 📈: Mevcut SHORT pozisyon kapatıldı ve 2 adet LONG emir ile geçiş tetiklendi.`);
        
      } else if (positionSide === "LONG") {
        console.log("Sinyal LONG: Zaten LONG pozisyondayız. Yeni işlem yapılmadı.");
      }
    }

    else if (fxuLast < settlementAverage5) {
      if (positionSide === "NONE") {
        console.log("Sinyal SHORT: Pozisyon yok. 1 adet SHORT emri gönderiliyor...");
        localPositionSide = "SHORT";

        await api.placeViopSellOrder({
          sozlesme: process.env.VIOP_SOZLESME,
          quantity: 1,
          orderType: "PKP",
          duration: "GUN",
          aksamSeansi: 0,
        });
        console.log("-> 1 Adet SHORT emir Meksa'ya başarıyla iletildi.");
        sendTelegramMessage(`Sinyal SHORT 📉: Pozisyon yoktu, Meksa'ya 1 adet SHORT emir iletildi.`);
        
      } else if (positionSide === "LONG") {
        console.log("Sinyal SHORT: Mevcut LONG pozisyon var. Kapatmak ve SHORT açmak için 2 adet SHORT emri gönderiliyor...");
        localPositionSide = "SHORT";

        await api.placeViopSellOrder({
          sozlesme: process.env.VIOP_SOZLESME,
          quantity: 2,
          orderType: "PKP",
          duration: "GUN",
          aksamSeansi: 0,
        });
        console.log("-> LONG kapatıldı ve 1 adet SHORT pozisyon açıldı.");
        sendTelegramMessage(`Sinyal SHORT 📉: Mevcut LONG pozisyon kapatıldı ve 2 adet SHORT emir ile geçiş tetiklendi.`);
        
      } else if (positionSide === "SHORT") {
        console.log("Sinyal SHORT: Zaten SHORT pozisyondayız. Yeni işlem yapılmadı.");
      }
    } else {
      console.log("FXU son fiyatı ortalamaya tam eşit. İşlem yapılmadı.");
    }

  } catch (error) {
    console.error("🚨 Emir Strateji Hatası (Meksa Bağlantısı):", error.message);
    sendTelegramMessage(`🚨 KRİTİK MEKSA HATASI: ${error.message}`);
    localPositionSide = null; 
  } finally {
    isTradeRunning = false;
  }
}, 2000);