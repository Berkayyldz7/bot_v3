// /home/baba_bot/services/reporter_service.js
const { MeksaApi } = require("./api_engine");
const fetch = require("node-fetch");

class ReporterService {
  constructor(marketDataService) {
    this.marketData = marketDataService;
    this.lastReportDay = null;
    this.api = new MeksaApi({
      customerNo: process.env.CUSTOMER_NO,
      token: process.env.TOKEN,
    });
  }

  // İnatçı Metot: Veri gelene kadar 3 saniyede bir dener
  async getViopPositionWithRetry() {
    console.log("🔄 Meksa'dan pozisyon verisi bekleniyor (Retry aktif)...");
    while (true) {
      try {
        const position = await this.api.getViopPositionsDetails();
        // Sözleşme adı eşleşiyorsa veya API hata vermediyse veriyi döndür
        if (position && position.sozlesmeAdi === process.env.VIOP_SOZLESME) {
          return position;
        }
      } catch (err) {
        console.log("⚠️ Meksa API geçici ulaşılamaz, 3 sn sonra tekrar deneniyor...");
      }
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }

  start() {
    console.log("📊 Günlük Seans Sonu Raporlama Servisi Pusuya Yattı (Saat 18:00 Bekleniyor)...");
    
    setInterval(async () => {
      const now = new Date();
      if (now.getHours() === 18 && now.getMinutes() === 0) {
        const todayStr = now.toDateString();
        if (this.lastReportDay === todayStr) return; 

        try {
          // 1. İnatçı metot ile pozisyonu al
          const position = await this.getViopPositionWithRetry();
          
          // 2. Diğer hesaplamalar
          const meksaAccount = await this.api.getViopFreeBalanceDetails();
          const freeNakit = Number(meksaAccount?.cekilebilirTeminat || 0);
          
          const amt = Number(position.tutar || 0);
          const activeLot = Math.abs(amt);
          const entryPrice = Number(position.islemFiyati || 0);
          
          let currentSide = "NONE";
          if (amt > 0) currentSide = "LONG";
          else if (amt < 0) currentSide = "SHORT";

          const fxuSnapshot = this.marketData.getFxuSnapshotWithTime();
          const currentPrice = fxuSnapshot ? Number(fxuSnapshot.data.last) : 0;

          if (currentPrice === 0) {
            console.log("⚠️ Fiyat verisi alınamadı, rapor erteleniyor.");
            return;
          }

          let netProfitTL = 0;
          if (currentSide === "LONG" && entryPrice > 0) netProfitTL = (currentPrice - entryPrice) * activeLot * 10;
          else if (currentSide === "SHORT" && entryPrice > 0) netProfitTL = (entryPrice - currentPrice) * activeLot * 10;

          const profitEmoji = netProfitTL >= 0 ? "💰 🟢 KÂR DURUMU:" : "📉 🔴 ZARAR DURUMU:";

          await this.sendTelegram(
            `📋 GÜNLÜK SEANS SONU RAPORU 📋\n\n` +
            `💼 Güncel Pozisyon Yönü: ${currentSide === "NONE" ? "Boşta (NONE) ⚪" : currentSide === "LONG" ? "LONG (Alış) 📈" : "SHORT (Satış) 📉"}\n` +
            `📦 Aktif Lot Miktarı: ${activeLot} Lot\n` +
            `🎯 Borsa Giriş Maliyeti: ${entryPrice > 0 ? entryPrice : "Pozisyon Yok"}\n` +
            `⚡ Seans Kapanış Fiyatı: ${currentPrice}\n` +
            `🏦 Çekilebilir Net Nakit: ${freeNakit} TL\n\n` +
            `${profitEmoji} ${netProfitTL.toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL`
          );

          this.lastReportDay = todayStr;
        } catch (err) {
          console.error("🚨 Günlük rapor servisi hatası:", err.message);
        }
      }
    }, 60000); 
  }

  async sendTelegram(text) {
    const token = process.env.TELEGRAM_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) return;
    try {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: `🤖 Rapor Servisi: ${text}` }),
      });
    } catch (e) {
      console.error("Rapor Telegram'a atılamadı:", e.message);
    }
  }
}

module.exports = { ReporterService };
