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

// Long Short Adet Miktarı İçin state.json Kayıt Alanı

const STATE_FILE = "./data/state.json";

function saveState(data) {
    try { fs.writeFileSync(STATE_FILE, JSON.stringify(data, null, 2)); }
    catch (e) { console.error("State kaydedilemedi:", e); }
}

function loadState() {
    const defaultState = { targetLot: 0, isUpdated: false };

    try {
        if (!fs.existsSync(STATE_FILE)) {
            return defaultState;
        }

        const parsed = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
        const targetLot = Number(parsed?.targetLot);
        const isUpdated = parsed?.isUpdated === true;

        if (!Number.isFinite(targetLot) || targetLot < 0) {
            return defaultState;
        }

        return {
            targetLot: Math.floor(targetLot),
            isUpdated,
        };
    } catch (e) {
        console.error("State okunamadı:", e);
        return defaultState;
    }
}

const state = loadState();

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
let localPositionSideUpdatedAt = null;
let isMatriksErrorNotified = false;
let lastReminderTime = 0;

const PENDING_POSITION_TIMEOUT_MS = 60000;

// 🚨 TELEGRAM KUMANDA KİLİDİ (Varsayılan olarak bot KAPALI başlar, Telegram'dan açılır)
let isBotEnabledByAdmin = false;
let lastUpdateId = 0;

function isRejectedOrderResponse(response) {
    if (!response || typeof response !== "object") return false;

    const text = (() => {
        try { return JSON.stringify(response).toLowerCase(); }
        catch (e) { return String(response).toLowerCase(); }
    })();

    return (
        response.success === false ||
        response.ok === false ||
        response.status === false ||
        Boolean(response.error) ||
        Boolean(response.hata) ||
        Boolean(response.hataMesaji) ||
        text.includes("reject") ||
        text.includes("rejected") ||
        text.includes("reddedildi") ||
        text.includes("başarısız")
    );
}

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
const reporter = new ReporterService(marketData, api);
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

    const fxuLast = Number(fxuSnapshot?.data?.last);
    const settlementAverage5 = Number(avg5);

    if (!Number.isFinite(fxuLast) || !Number.isFinite(settlementAverage5)) return;

    // 🛡️ ADIM 2: CANLI TEMİNAT OKUMA VE SAFE BLOCK
    const currentInitialMargin = fxuSnapshot?.data?.initialMargin ? Number(fxuSnapshot.data.initialMargin) : null;

    if (!Number.isFinite(currentInitialMargin) || currentInitialMargin <= 0) {
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
            const pendingAgeMs = localPositionSideUpdatedAt ? Date.now() - localPositionSideUpdatedAt : 0;

            if (pendingAgeMs > PENDING_POSITION_TIMEOUT_MS) {
                console.log(`[SENKRONİZASYON KRİTİK] ${localPositionSide} emri ${Math.round(pendingAgeMs / 1000)} saniyedir Meksa pozisyonuna yansımadı. Bot durduruldu.`);
                await sendTelegramMessage(`🚨 KRİTİK ALARM: ${localPositionSide} emri ${Math.round(pendingAgeMs / 1000)} saniyedir Meksa pozisyonuna yansımadı.\n🛑 Bot güvenlik için durduruldu. Lütfen pozisyonlarınızı elle kontrol edin.`);
                isBotEnabledByAdmin = false;
                localPositionSide = null;
                localPositionSideUpdatedAt = null;
            } else {
                console.log(`[SENKRONİZASYON] ${localPositionSide} emri iletildi ancak Meksa hala ${realPositionSide} gösteriyor. API güncellemesi bekleniyor...`);
            }

            isTradeRunning = false;
            return;
        }


        if (localPositionSide !== null && localPositionSide === realPositionSide) {
            sendTelegramMessage(`Borsa ile senkronizasyon sağlandı. Güncel Pozisyon: ${realPositionSide} ✅`);
            localPositionSide = null;
            localPositionSideUpdatedAt = null;
        }

        // STATE İle Long Ve Short Emir sayısı Kontrlü Adım-1

        // --- YENİ VE TEK GÜVENLİ BLOK ---

        let lot = 0;

        if (realPositionSide === "NONE") {
            try {
                const meksaAccount = await api.getViopFreeBalanceDetails();
                const freeNakit = Number(meksaAccount?.cekilebilirTeminat || 0);
                const safeContractCost = currentInitialMargin * 1.25;
                const calculatedTargetLot = Math.floor(freeNakit / safeContractCost);

                if (!Number.isFinite(freeNakit) || freeNakit <= 0) {
                    console.log("⚠️ [KRİTİK PAS] Çekilebilir teminat okunamadı veya yetersiz.");
                    isTradeRunning = false;
                    return;
                }

                if (!Number.isFinite(safeContractCost) || safeContractCost <= 0) {
                    console.log("⚠️ [KRİTİK PAS] Güvenli kontrat maliyeti hesaplanamadı.");
                    isTradeRunning = false;
                    return;
                }

                if (!Number.isFinite(calculatedTargetLot) || calculatedTargetLot < 1) {
                    console.log("❌ Lot sayısı 1'in altında, işlem durduruldu.");
                    isTradeRunning = false;
                    return;
                }

                state.targetLot = calculatedTargetLot;
                state.isUpdated = true;
                saveState(state);
            } catch (e) {
                console.error("Bakiye sorgulanamadı:", e);
                isTradeRunning = false;
                return;
            }

            lot = Number(state.targetLot);
        } else {
            const savedTargetLot = Number(state.targetLot);

            if (!Number.isFinite(savedTargetLot) || savedTargetLot < 1) {
                console.log("🚨 [KRİTİK PAS] Açık pozisyon var ama state.targetLot geçersiz. Ters işlem güvenli hesaplanamaz.");
                await sendTelegramMessage("🚨 KRİTİK ALARM: Açık pozisyon var ama state.targetLot geçersiz. Ters işlem güvenli hesaplanamaz.\n🛑 Bot güvenlik için durduruldu. Lütfen pozisyonlarınızı elle kontrol edin.");
                isBotEnabledByAdmin = false;
                isTradeRunning = false;
                return;
            }

            lot = savedTargetLot * 2;
        }

        // Güvenlik: Eğer hesaplanan lot geçersizse işlem yapma
        if (!Number.isFinite(lot) || lot < 1) {
            console.log("❌ Lot sayısı geçersiz veya 1'in altında, işlem durduruldu.");
            isTradeRunning = false;
            return;
        }

        lot = Math.floor(lot);





        // --- SENARYO A: SİNYAL LONG (Fiyat Ortalamanın Üstünde) ---
        if (fxuLast > settlementAverage5) {
            if (realPositionSide !== "LONG") {

                if (realPositionSide === "NONE") {
                    await sendTelegramMessage(`📊 EMİR TETİKLENDİ (Yön: LONG 📈)
🚀 İşleme Girilecek Lot Sayısı: ${lot} Lot`);
                    localPositionSide = "LONG";
                    localPositionSideUpdatedAt = Date.now();

                    await sendTelegramMessage(`🧪 TEST MODU - MEKSA'YA GERÇEK EMİR GÖNDERİLMEDİ.
Normalde gönderilecek emir:
BUY / LONG
Sözleşme: ${process.env.VIOP_SOZLESME}
Lot: ${lot}
Order Type: PKP
Duration: GUN
Akşam Seansı: 0`);

                    const orderResult = { success: true, dryRun: true };

                    /*
                    const orderResult = await api.placeViopBuyOrder({
                      sozlesme: process.env.VIOP_SOZLESME,
                      quantity: lot,
                      orderType: "PKP",
                      duration: "GUN", 
                      aksamSeansi: 0,
                    });
                    */

                    if (isRejectedOrderResponse(orderResult)) {
                        throw new Error(`LONG emir Meksa tarafından reddedilmiş olabilir: ${JSON.stringify(orderResult)}`);
                    }
                }
                else if (realPositionSide === "SHORT") {
                    await sendTelegramMessage(`🚨 [TERSE TAKLA -> LONG 📈]
🚀 ${lot} Lot Emir Gönderiliyor.`);
                    localPositionSide = "LONG";
                    localPositionSideUpdatedAt = Date.now();

                    await sendTelegramMessage(`🧪 TEST MODU - MEKSA'YA GERÇEK EMİR GÖNDERİLMEDİ.
Normalde gönderilecek emir:
BUY / SHORT KAPAT + LONG AÇ
Sözleşme: ${process.env.VIOP_SOZLESME}
Lot: ${lot}
Order Type: PKP
Duration: GUN
Akşam Seansı: 0`);

                    const orderResult = { success: true, dryRun: true };

                    /*
                    const orderResult = await api.placeViopBuyOrder({
                      sozlesme: process.env.VIOP_SOZLESME,
                      quantity: lot, 
                      orderType: "PKP",
                      duration: "GUN", 
                      aksamSeansi: 0,
                    });
                    */

                    if (isRejectedOrderResponse(orderResult)) {
                        throw new Error(`TERSE TAKLA LONG emir Meksa tarafından reddedilmiş olabilir: ${JSON.stringify(orderResult)}`);
                    }
                }
            }
        }

        // --- SENARYO B: SİNYAL SHORT (Fiyat Ortalamanın Altında) ---
        else if (fxuLast < settlementAverage5) {
            if (realPositionSide !== "SHORT") {

                if (realPositionSide === "NONE") {
                    await sendTelegramMessage(`📊 EMİR TETİKLENDİ (Yön: SHORT 📉)
🚀 İşleme Girilecek Lot Sayısı: ${lot} Lot`);
                    localPositionSide = "SHORT";
                    localPositionSideUpdatedAt = Date.now();

                    await sendTelegramMessage(`🧪 TEST MODU - MEKSA'YA GERÇEK EMİR GÖNDERİLMEDİ.
Normalde gönderilecek emir:
SELL / SHORT
Sözleşme: ${process.env.VIOP_SOZLESME}
Lot: ${lot}
Order Type: PKP
Duration: GUN
Akşam Seansı: 0`);

                    const orderResult = { success: true, dryRun: true };

                    /*
                    const orderResult = await api.placeViopSellOrder({
                      sozlesme: process.env.VIOP_SOZLESME,
                      quantity: lot,
                      orderType: "PKP",
                      duration: "GUN", 
                      aksamSeansi: 0,
                    });
                    */

                    if (isRejectedOrderResponse(orderResult)) {
                        throw new Error(`SHORT emir Meksa tarafından reddedilmiş olabilir: ${JSON.stringify(orderResult)}`);
                    }
                }
                else if (realPositionSide === "LONG") {
                    await sendTelegramMessage(`🚨 [TERSE TAKLA -> SHORT 📉]
🚀 ${lot} Lot Emir Gönderiliyor.`);
                    localPositionSide = "SHORT";
                    localPositionSideUpdatedAt = Date.now();

                    await sendTelegramMessage(`🧪 TEST MODU - MEKSA'YA GERÇEK EMİR GÖNDERİLMEDİ.
Normalde gönderilecek emir:
SELL / LONG KAPAT + SHORT AÇ
Sözleşme: ${process.env.VIOP_SOZLESME}
Lot: ${lot}
Order Type: PKP
Duration: GUN
Akşam Seansı: 0`);

                    const orderResult = { success: true, dryRun: true };

                    /*
                    const orderResult = await api.placeViopSellOrder({
                      sozlesme: process.env.VIOP_SOZLESME,
                      quantity: lot, 
                      orderType: "PKP",
                      duration: "GUN", 
                      aksamSeansi: 0,
                    });
                    */

                    if (isRejectedOrderResponse(orderResult)) {
                        throw new Error(`TERSE TAKLA SHORT emir Meksa tarafından reddedilmiş olabilir: ${JSON.stringify(orderResult)}`);
                    }
                }
            }
        }

        if (realPositionSide === "NONE") {
            state.isUpdated = false;
            saveState(state);
        }

    } catch (error) {
        console.error("🚨 Emir Strateji Hatası:", error.message);
        sendTelegramMessage(`🚨 KRİTİK MEKSA HATASI: ${error.message}`);
        localPositionSide = null;
        localPositionSideUpdatedAt = null;
    } finally {
        isTradeRunning = false;
    }
}, 2000);
