const mqtt = require("mqtt");
const pb = require("protobufjs");
const dotenv = require("dotenv");
const path = require("path");

dotenv.config({
  path: path.resolve(__dirname, "../.env"),
});

class MarketDataService {
  constructor() {
    // Orijinal hantal şemana hiyerarşiyi bozmamak için asla dokunmuyoruz
    this.derivativeMessage = pb
      .loadSync(path.resolve(__dirname, "./proto/Derivative.proto"))
      .lookupType("messages.DerivativeMessage");

    this.state = {
      fxu: null,
      fxuTime: null,
    };

    // Seçeneklerde artık uzak şifrelere gerek yok, yerel bağlantı parametreleri yeterli
    this.options = {
      reconnectPeriod: 3000,
      connectTimeout: 5000,
      keepalive: 60,
      protocolVersion: 3,
      protocolId: "MQIsdp",
    };

    this.fxuClient = null;
    this.onErrorCallback = null; 
    this.onConnectCallback = null; 
  }

  onError(handler) { this.onErrorCallback = handler; }
  onConnect(handler) { this.onConnectCallback = handler; }

  start() {
    // KİLİT NOKTA: Uzak Matriks yerine sunucu içindeki güvenli yerel Broker'a bağlanıyoruz
    this.fxuClient = mqtt.connect("mqtt://localhost:1883", this.options);

    this.fxuClient.on("connect", () => {
      console.log("🟢 Yerel FXU soketine bağlandı");
      if (this.onConnectCallback) this.onConnectCallback();

      // matriks_feeder'ın sunucu içinde yayın yaptığı o saf kanala abone oluyoruz
      this.fxuClient.subscribe("yerel/viop/veri", (error) => {
        if (error && this.onErrorCallback) {
          this.onErrorCallback(error.message);
        }
      });
    });

    this.fxuClient.on("message", (topic, payload) => {
      try {
        // matriks_feeder ham veriyi pasladığı için decode işlemi artık tek bir soketle izole ve hatasız çalışacak!
        const decoded = this.derivativeMessage.decode(payload);
        const partial = this.derivativeMessage.toObject(decoded, {
          longs: Number,
          enums: String,
          defaults: false,
        });

        this.state.fxu = {
          ...(this.state.fxu || {}),
          ...partial,
        };

        this.state.fxuTime = Date.now();
      } catch (error) {
        if (this.onErrorCallback) this.onErrorCallback(`Decode Hatası: ${error.message}`);
      }
    });

    this.fxuClient.on("error", (error) => {
      console.error("Yerel FXU soket hatası:", error.message);
      if (this.onErrorCallback) this.onErrorCallback(error.message);
    });
  }

  getFxuSnapshot() {
    return this.state.fxu;
  }

  getFxuSnapshotWithTime() {  
    if (!this.state.fxu) return null;

    return {
      data: this.state.fxu,
      receivedAt: this.state.fxuTime,
      marketTime: this.state.fxu.updateDate
    };
  }

  getViopSettlementPrice() {
    if (!this.state.fxu) return null;
    if (this.state.fxu.settlement === undefined) return null;
    return this.state.fxu.settlement;
  }
}

module.exports = {
  MarketDataService,
};
