const { MarketDataService } = require("./services/merket_data_service");
const { FxuSettlementRecorder } = require("./services/fxu_settlement_recorder");
const { SettlementAverage } = require("./services/SettlementAverage");
const { MeksaApi } = require("./services/api_engine");
const { ReporterService } = require("./services/reporter_service");

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
let lastUpdateId = 0; 

async function sendTelegramMessage(text) {
  const token = process.env.TELEGRAM_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;

  try {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
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
        reply_markup: keyboard 
      }),
    });
  } catch (err) {
    console.error("Telegram mesajı gönderilemedi:", err.message);
  }
}

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

// SOKET KOPMA ALARMLARI
marketData.onError((errorMessage) => {
  if (!isMatriksErrorNotified) {
    sendTelegramMessage(`🚨 KRİTİK ALARM: Matriks Bağlantısı Sağlanamadı veya Koptu! Arıza Detayı: ${errorMessage}\n⚠️ İşlemler askıya alındı.`);
    isMatriksErrorNotified = true; 
    lastReminderTime = Date.now(); 
  }
});

marketData.onConnect(() => {
  if (isMatriksErrorNotified) {
    sendTelegramMessage(`✅ BİLGİ: Matriks soket bağlantısı başarıyla onarıldı, veri akışı taze.`);
    isMatriksErrorNotified = false; 
  }
});

marketData.start();

// 💡 GÜNLÜK RAPORLAMA SERVİSİ (Ayrı servis olarak tetikleniyor)
const reporter = new ReporterService(marketData);
reporter.start();

const recorder = new FxuSettlementRecorder(marketData, settlementAverage, {
  intervalMs: 30000,
  outputFile: "./data/fxu-settlements.json",
});

// Cumartesi (6) veya Pazar (0) ise recorder hiç çalışmasın, çöp veri yazmasın:
const currentDay = new Date().getDay();
if (currentDay !== 0 && currentDay !== 6) {
  recorder.start(); 
} else {
  console.log("⚠️ [REKORDER KİLİDİ] Hafta sonu olduğu için uzlaşı kaydedici başlatılmadı.");
}

sendTelegramMessage("Sunucuda başarıyla ayağa kalktım. Trade işlemini başlatmak için lütfen aşağıdaki yeşil butona basın! 🔌");
setInterval(checkTelegramCommands, 1000);

// ANA STRATEJİ DÖNGÜSÜ
setInterval(async () => {
  if (!isBotEnabledByAdmin) return; 
  if (isTradeRunning) return;

  const fxuSnapshot = marketData.getFxuSnapshotWithTime();
  const avg5 = settlementAverage.getAverage5();

  // 🚨 GERİ GELEN KORUMA 1: MATRİKS'TEN VERİ HİÇ GELMİYORSA YA DA HAZIR DEĞİLSE
  if (!fxuSnapshot || avg5 == null) {
    console.log("FXU veya avg5 verisi henüz hazır değil, bekleniyor...");
    if (!isMatriksErrorNotified) {
      sendTelegramMessage(`🚨 KRİTİK ALARM: Matriks Canlı Veri Akışı Mevcut Değil! Veri bekleniyor...`);
      isMatriksErrorNotified = true;
      lastReminderTime = Date.now();
    } else {
      if (Date.now() - lastReminderTime > 300000) { // 5 dakikada bir hatırlatır
        sendTelegramMessage(`⚠️ HATIRLATMA: Matriks veri akışı hala sağlanamadı. Bot beklemede. Lütfen pozisyonlarınızı elinizle kontrol edin!`);
        lastReminderTime = Date.now();
      }
    }
    return;
  }

  // 🚨 GERİ GELEN KORUMA 2: VERİ AKIŞI ZAMAN AŞIMI (BAYAT VERİ) KONTROLÜ
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

  // Eğer bağlantılar düzeldiyse hata bayrağını indiriyoruz
  if (isMatriksErrorNotified) {
    sendTelegramMessage(`✅ BİLGİ: Matriks canlı veri akışı normale döndü, pazar taranıyor.`);
    isMatriksErrorNotified = false;
  }

  const fxuLast = Number(fxuSnapshot.data.last);
  const settlementAverage5 = Number(avg5);

  if (!Number.isFinite(fxuLast) || !Number.isFinite(settlementAverage5)) return;

  // 🛡️ ADIM 2: CANLI TEMİNAT OKUMA VE SAFE BLOCK
  const currentInitialMargin = fxuSnapshot.data.initialMargin ? Number(fxuSnapshot.data.initialMargin) : null;

  if (!currentInitialMargin || currentInitialMargin <= 0) {
    console.log("⚠️ [KRİTİK PAS] Canlı teminat okunamadı!");
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
       sendTelegramMessage(`Borsa ile senkronizasyon sağlandı. Güncel Pozisyon: ${realPositionSide} ✅`);
       localPositionSide = null;
    }

    const positionSide = realPositionSide;
    
    // 🛡️ ADIM 1: MEKSA'DAN SAF ÇEKİLEBİLİR BAKİYEYİ ÇEKİYORUZ
    const meksaAccount = await api.getViopAccountDetails();
    const freeNakit = Number(meksaAccount.cekilebilirTeminat || 0); 

    // 🛡️ ADIM 4: MARGİNCALL'A DÜŞMEMEK İÇİN GÜVENLİ KONTRAT MALİYETİ (Teminat * 1.5)
    const safeContractCost = currentInitialMargin * 1.25;

    // 🛡️ ADIM 3: SIFIRDAN BİR YÖNE GİRERKEN BAZ ALINACAK MAKSİMUM SAFE LOT MİKTARI
    const max_safe_lot_miktari = Math.floor(freeNakit / safeContractCost);

    // --- SENARYO A: SİNYAL LONG (Fiyat Ortalamanın Üstünde) ---
    if (fxuLast > settlementAverage5) {
      if (positionSide !== "LONG") {
        
        // 1. İHTİMAL: HİÇ POZİSYON YOKSA
        if (positionSide === "NONE") {
          if (max_safe_lot_miktari < 1) {
            console.log(`❌ [BAKİYE YETERSİZ] LONG sinyali var ama çekilebilir nakit (${freeNakit} TL) güvenli 1 lot maliyetini (${safeContractCost} TL) karşılamıyor!`);
            isTradeRunning = false;
            return;
          }

          await sendTelegramMessage(
            `📊 EMİR TETİKLENDİ (Yön: LONG 📈)\n\n` +
            `🔹 Canlı Başlangıç Teminatı: ${currentInitialMargin} TL\n` +
            `🔹 Hesapta Boşta Çekilebilir Bakiye: ${freeNakit} TL\n` +
            `🛡️ Kontrat Başı Güvenli Maliyet (x1.25): ${safeContractCost} TL\n` +
            `🚀 İşleme Girilecek Güvenli Kontrat Sayısı: ${max_safe_lot_miktari} Lot`
          );

          localPositionSide = "LONG"; 
          await api.placeViopBuyOrder({
            sozlesme: process.env.VIOP_SOZLESME,
            quantity: max_safe_lot_miktari,
            orderType: "PKP",
            duration: "GUN", 
            aksamSeansi: 0,
          });
        } 
        
        // 2. İHTİMAL: TERS SİNYAL! (İLK GÜVENLİ LOTUN 2 KATI EMİR ÇAK!)
        else if (positionSide === "SHORT") {
          const reverseQuantity = max_safe_lot_miktari * 2; 

          if (reverseQuantity < 2) {
            isTradeRunning = false;
            return;
          }

          await sendTelegramMessage(
            `🚨 [TERSE TAKLA -> LONG 📈]\n\n` +
            `🚀 Strateji Gereği Mevcut Pozisyonu Kapatıp Terse Geçmek İçin ${reverseQuantity} Lot (${max_safe_lot_miktari} x 2) Emir Gönderiliyor.`
          );

          localPositionSide = "LONG"; 
          await api.placeViopBuyOrder({
            sozlesme: process.env.VIOP_SOZLESME,
            quantity: reverseQuantity, 
            orderType: "PKP",
            duration: "GUN", 
            aksamSeansi: 0,
          });
        }
      } else {
        // 🚨 EKLEMEYİ UNUTTUĞUMUZ LOG GERİ GELDİ: Zaten LONG yöndeysek
        console.log("Sinyal LONG: Zaten LONG pozisyondayız. Yeni işlem yapılmadı.");
      }
    }

    // --- SENARYO B: SİNYAL SHORT (Fiyat Ortalamanın Altında) ---
    else if (fxuLast < settlementAverage5) {
      if (positionSide !== "SHORT") {

        // 1. İHTİMAL: HİÇ POZİSYON YOKSA
        if (positionSide === "NONE") {
          if (max_safe_lot_miktari < 1) {
            console.log(`❌ [BAKİYE YETERSİZ] SHORT sinyali var ama çekilebilir nakit (${freeNakit} TL) güvenli 1 lot maliyetini (${safeContractCost} TL) karşılamıyor!`);
            isTradeRunning = false;
            return;
          }

          await sendTelegramMessage(
            `📊 EMİR TETİKLENDİ (Yön: SHORT 📉)\n\n` +
            `🔹 Canlı Başlangıç Teminatı: ${currentInitialMargin} TL\n` +
            `🔹 Hesapta Boşta Çekilebilir Bakiye: ${freeNakit} TL\n` +
            `🛡️ Kontrat Başı Güvenli Maliyet (x1.25): ${safeContractCost} TL\n` +
            `🚀 İşleme Girilecek Güvenli Kontrat Sayısı: ${max_safe_lot_miktari} Lot`
          );

          localPositionSide = "SHORT";
          await api.placeViopSellOrder({
            sozlesme: process.env.VIOP_SOZLESME,
            quantity: max_safe_lot_miktari,
            orderType: "PKP",
            duration: "GUN", 
            aksamSeansi: 0,
          });
        } 
        
        // 2. İHTİMAL: TERS SİNYAL! (İLK GÜVENLİ LOTUN 2 KATI EMİR ÇAK!)
        else if (positionSide === "LONG") {
          const reverseQuantity = max_safe_lot_miktari * 2; 

          if (reverseQuantity < 2) {
            isTradeRunning = false;
            return;
          }

          await sendTelegramMessage(
            `🚨 [TERSE TAKLA -> SHORT 📉]\n\n` +
            `🚀 Strateji Gereği Mevcut Pozisyonu Kapatıp Terse Geçmek İçin ${reverseQuantity} Lot (${max_safe_lot_miktari} x 2) Emir Gönderiliyor.`
          );

          localPositionSide = "SHORT";
          await api.placeViopSellOrder({
            sozlesme: process.env.VIOP_SOZLESME,
            quantity: reverseQuantity, 
            orderType: "PKP",
            duration: "GUN", 
            aksamSeansi: 0,
          });
        }
      }else {
        // 🚨 EKLEMEYİ UNUTTUĞUMUZ LOG GERİ GELDİ: Zaten SHORT yöndeysek
        console.log("Sinyal SHORT: Zaten SHORT pozisyondayız. Yeni işlem yapılmadı.");
      }
    }

  } catch (error) {
    console.error("🚨 Emir Strateji Hatası:", error.message);
    sendTelegramMessage(`🚨 KRİTİK MEKSA HATASI: ${error.message}`);
    localPositionSide = null; 
  } finally {
    isTradeRunning = false;
  }
}, 2000);
