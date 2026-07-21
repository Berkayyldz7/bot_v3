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

  // Bağımsız raporlama motorunu başlatır
  start() {
    console.log("📊 Günlük Seans Sonu Raporlama Servisi Pusuya Yattı (Saat 18:00 Bekleniyor)...");
    
    setInterval(async () => {
      const now = new Date();
      
      // Tam seans kapanışına yakın saat 18:00'de tetiklenir
      if (now.getHours() === 18 && now.getMinutes() === 0) {
        const todayStr = now.toDateString();
        if (this.lastReportDay === todayStr) return; // Bugün zaten atıldıysa pas geç

        try {
          // 1. Meksa'dan o anki çıplak çekilebilir parayı ve açık pozisyonu çek
          const meksaAccount = await this.api.getViopAccountDetails();
          const position = await this.api.getViopPositionsDetails();
          
          const freeNakit = Number(meksaAccount.cekilebilirTeminat || 0);
          let currentSide = "NONE";
          let activeLot = 0;
          let entryPrice = 0;

          if (position && position.sozlesmeAdi === process.env.VIOP_SOZLESME) {
            const amt = Number(position.tutar || 0);
            activeLot = Math.abs(amt);
            entryPrice = Number(position.islemFiyati || 0); // Meksa'nın kendi hafızasındaki gerçek giriş maliyeti!
            
            if (amt > 0) currentSide = "LONG";
            else if (amt < 0) currentSide = "SHORT";
          }

          // 2. Sunucudaki matriks-feeder'dan o saniyede akan CANLI son fiyatı al
          const fxuSnapshot = this.marketData.getFxuSnapshotWithTime();
          const currentPrice = fxuSnapshot ? Number(fxuSnapshot.data.last) : 0;

          if (currentPrice === 0) {
            console.log("⚠️ Raporlama anında Matriks canlı fiyatı okunamadı, rapor erteleniyor.");
            return;
          }

          // 3. Kar / Zarar Hesaplama Matematiği
          let netProfitTL = 0;
          if (currentSide === "LONG" && entryPrice > 0) {
            netProfitTL = (currentPrice - entryPrice) * activeLot * 10;
          } else if (currentSide === "SHORT" && entryPrice > 0) {
            netProfitTL = (entryPrice - currentPrice) * activeLot * 10;
          }

          const profitEmoji = netProfitTL >= 0 ? "💰 🟢 KÂR DURUMU:" : "📉 🔴 ZARAR DURUMU:";

          // 4. Telegram'a şık raporu bağımsız fırlat
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
    }, 60000); // Saati kontrol etmek için her dakikada bir uyanır
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
