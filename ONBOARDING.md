# Meksa Algoritmik İşlem Botu (V3) - Onboarding Dokümanı

Hoş geldin! Bu doküman, **Meksa Bot V3** projesinin kod tabanını, genel mimarisini, strateji mantığını ve kurulum adımlarını hızlıca kavramanı sağlamak için hazırlanmıştır.

## 1. Proje Özeti
Bu proje, **Meksa Yatırım API'si** ve **Matriks** canlı veri akışı (MQTT + Protobuf üzerinden) kullanarak VİOP tarafında otomatik işlem (Algoritmik Trade) yapan bir Node.js botudur. 

Temel strateji; ilgili VİOP sözleşmesinin anlık fiyatını, son 5 günlük uzlaşma (settlement) ortalamasıyla kıyaslayarak trend yönünde (LONG veya SHORT) işlemler açmaktır. Sistem, Telegram entegrasyonu ile uzaktan yönetilebilir ve gün sonu raporları sunar.

## 2. Mimari ve Dizin Yapısı

Proje temel olarak modüler bir servis mimarisine sahiptir. Ana mantık `app.js` üzerinde dönmekte ve diğer tüm işlemler `services` klasöründeki yardımcı modüllerle yürütülmektedir.

```text
bot_v3/
├── app.js                         # Ana uygulama dosyası ve strateji döngüsü.
├── data/                          # Kayıt dosyalarının (state.json, fxu-settlements.json) tutulduğu klasör.
├── proto/                         # Protobuf (.proto) şemalarının bulunduğu dizin.
├── services/                      # Ana iş mantıklarını yöneten servisler.
│   ├── api_engine.js              # Meksa API entegrasyonu (Emir, bakiye, pozisyon).
│   ├── merket_data_service.js     # Yerel MQTT sunucusundan canlı Matriks fiyat akışını dinleyen servis.
│   ├── SettlementAverage.js       # Son 5 günlük uzlaşı fiyatının ortalamasını hesaplar.
│   ├── fxu_settlement_recorder.js # Her akşam saat 18:15'ten sonra günün uzlaşı fiyatını kaydeder.
│   ├── reporter_service.js        # Her akşam saat 18:00'da Telegram'a gün sonu kâr/zarar özetini atar.
│   ├── data_flow.js               # Matriks websocket'e doğrudan bağlantı sağlayan alternatif/legacy veri akış servisi.
│   └── create_token.js            # Meksa API'den token almak için yardımcı script.
├── package.json                   # Bağımlılıklar (dotenv, node-fetch, mqtt, protobufjs).
└── .env                           # (Mevcut olmalı) Çevresel değişkenler ve gizli anahtarlar.
```

## 3. Temel Bileşenler ve Görevleri

### `app.js` (Ana Yönetici ve Strateji Motoru)
- Sistemin giriş noktasıdır.
- Telegram üzerinden gelecek "Başlat/Durdur" komutlarını dinler. Varsayılan olarak bot pasif başlar ve admin onayıyla aktifleşir.
- Canlı fiyat verisi `merket_data_service` üzerinden, ortalama veri ise `SettlementAverage` üzerinden alınır.
- `state.json` üzerinde güncel Lot ve Yön bilgisini saklayarak sistem çökmelerine karşı kaldığı yerden devam etme yeteneği kazanır.
- **Güvenlik kilitleri içerir:** Fiyat bayat ise (maxAgeMs: 10sn) veya borsa ile senkronizasyon koptuğunda işlemleri otomatik durdurur.

### `api_engine.js` (Meksa API Motoru)
- Meksa'nın Optimus altyapısı ile HTTP POST istekleri (form-urlencoded) üzerinden haberleşir.
- Spot ve VİOP emir gönderimi, iptali, iyileştirmesi ile portföy/teminat durumlarının alınmasını sağlayan sınıftır (`MeksaApi`).

### `merket_data_service.js` (Piyasa Verisi - MQTT)
- `matriks_feeder` gibi başka bir yerel kaynaktan yayınlanan MQTT (`localhost:1883`) verilerini dinler.
- Gelen Binary (Protobuf) veriyi `Derivative.proto` şeması ile çözer ve fiyat objesi haline getirir.

### Algoritmik Strateji (`app.js` içerisinde)
Ana strateji son derece net bir trend takibi algoritmasıdır:
1. **Teminat Kontrolü:** Hesaptaki kullanılabilir "çekilebilir teminat" üzerinden güvenli lot sayısı (kontrat maliyetinin %25 fazlası pay bırakılarak) hesaplanır.
2. **Alım (LONG) Sinyali:** Anlık Fiyat (`fxuLast`) > 5 Günlük Ortalama (`settlementAverage5`) ise.
3. **Satım (SHORT) Sinyali:** Anlık Fiyat (`fxuLast`) < 5 Günlük Ortalama (`settlementAverage5`) ise.
4. **Terse Düşme (Terse Takla):** Mevcut bir SHORT pozisyonu varken sinyal LONG'a dönerse, sistem mevcut hedef lotun 2 katı emir göndererek hem eski pozisyonu kapatır hem de yeni yöne geçer.

## 4. Güvenlik ve Uyarı Mekanizmaları

- **Telegram Kontrolü:** Tüm sistem Telegram'dan "/start" veya menüdeki butonlarla tetiklenir.
- **Canlı Veri (Bayatlık) Kontrolü:** Fiyat akışı 10 saniyeden fazla durursa bot güvenlik amacıyla işlemleri askıya alır.
- **Senkronizasyon Timeout:** Gönderilen bir emir 60 saniye (`PENDING_POSITION_TIMEOUT_MS`) içerisinde Meksa tarafına yansımazsa bot uyarı verip durur.
- **Teminat Koruması:** Kullanılabilir nakit yetersizliğinde veya ters bir matematiksel hatada bot kendini dondurur.

## 5. Kurulum ve Çalıştırma Ortamı

Projeyi geliştirme veya canlı ortamında ayağa kaldırmak için aşağıdaki adımları izleyebilirsin:

**1. Bağımlılıkların Yüklenmesi:**
```bash
npm install
```

**2. Çevresel Değişkenlerin Ayarlanması (`.env`):**
Proje ana dizininde bir `.env` dosyası oluşturulmalı ve şu parametreler girilmelidir:
```env
CUSTOMER_NO=senin_meksa_musteri_non
TOKEN=meksa_api_tokenin
VIOP_SOZLESME=F_XU0300426
TELEGRAM_TOKEN=bot_token
TELEGRAM_CHAT_ID=admin_chat_id
# ve diğer gerekli parametreler...
```

**3. Projeyi Çalıştırma:**
```bash
npm start
```
Ayrıca `package.json` içerisinde bulunan `npm run recorder` (uzlaşı kaydediciyi test etmek/izole çalıştırmak için) ve `npm run take_token` (API Token almak için) komutları mevcuttur.

## 6. Geliştirici İçin Notlar
- `app.js` içerisindeki ana döngü (`setInterval(..., 2000)`) her 2 saniyede bir piyasa koşullarını değerlendirir. Buradaki mantığı değiştirirken asenkron bekleme durumlarına (race conditions) dikkat edilmelidir.
- Mevcut yapı yerel bir MQTT brokerına bağımlıdır (`localhost:1883`). Geliştirme ortamında bu bağlantının simüle edilmesi veya açık olması gerekir.
- Telegram bildirimleri sistemin "Gözü ve Kulağı"dır. Yapılan her mantıksal değişikliğin (hata fırlatma vs.) mutlaka `sendTelegramMessage` ile desteklendiğinden emin olunmalıdır.

İyi çalışmalar ve bol kazançlı kodlamalar! 🚀
