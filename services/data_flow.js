const mqtt = require("mqtt");
const pb = require("protobufjs");
const dotenv = require("dotenv");
const path = require("path");

console.log("[LIVEMARKETSTREAM FILE LOADED]", __filename);

dotenv.config({
  path: path.resolve(__dirname, "../.env"),
});

class LiveMarketStream {
  constructor({
    xu100Code = "XU100",
    viopCode = process.env.VIOP_SOZLESME,
  } = {}) {
    console.log("[DATA_FLOW CONSTRUCTOR]");
    console.log("[LIVEMARKETSTREAM CONSTRUCTOR CALLED]");

    if (!viopCode) {
      throw new Error("VIOP_SOZLESME .env icinde tanimli olmali.");
    }

    this.xu100Code = xu100Code;
    this.viopCode = viopCode;

    this.spotHandlers = new Set();
    this.viopHandlers = new Set();

    this.spotClient = null;
    this.viopClient = null;
    this.started = false;

    this.options = {
      reconnectPeriod: 3000,
      connectTimeout: 5000,
      keepalive: 60,
      username: "JWT",
      password: process.env.PWDd,
      rejectUnauthorized: false,
      qos: 0,
      protocolVersion: 3,
      protocolId: "MQIsdp",
    };

    this.symbolMessage = pb
      .loadSync(path.resolve(__dirname, "./proto/Symbol.proto"))
      .lookupType("messages.SymbolMessage");

    this.derivativeMessage = pb
      .loadSync(path.resolve(__dirname, "./proto/Derivative.proto"))
      .lookupType("messages.DerivativeMessage");
  }

  async start() {
    console.log("[DATA_FLOW START]");
    console.log("[LIVEMARKETSTREAM START CALLED]");

    if (this.started) {
      return;
    }

    await Promise.all([this._connectSpot(), this._connectViop()]);
    this.started = true;
  }

  async stop() {
    const closers = [];

    if (this.spotClient) {
      const client = this.spotClient;
      this.spotClient = null;
      closers.push(new Promise((resolve) => client.end(false, {}, resolve)));
    }

    if (this.viopClient) {
      const client = this.viopClient;
      this.viopClient = null;
      closers.push(new Promise((resolve) => client.end(false, {}, resolve)));
    }

    await Promise.all(closers);
    this.started = false;
  }

  onXu100(handler) {
    if (typeof handler !== "function") {
      throw new Error("onXu100 icin function vermelisiniz.");
    }

    this.spotHandlers.add(handler);
    return () => this.spotHandlers.delete(handler);
  }

  onViop(handler) {
    if (typeof handler !== "function") {
      throw new Error("onViop icin function vermelisiniz.");
    }

    this.viopHandlers.add(handler);
    return () => this.viopHandlers.delete(handler);
  }

  _connectSpot() {
    console.log("[LIVEMARKETSTREAM _connectSpot ENTERED]");

    return new Promise((resolve, reject) => {
      const client = mqtt.connect(
        "wss://dltest.radix.matriksdata.com:443/market",
        this.options
      );

      this.spotClient = client;
      let settled = false;

      client.on("connect", () => {
        client.subscribe(`mx/symbol/${this.xu100Code}@lvl2`, (error, granted) => {
          if (error) {
            if (!settled) {
              settled = true;
              reject(error);
            }
            return;
          }

          if (!granted || !granted.length) {
            if (!settled) {
              settled = true;
              reject(new Error("XU100 subscribe onayi alinmadi."));
            }
            return;
          }

          if (!settled) {
            settled = true;
            resolve();
          }
        });
      });

      client.on("message", (topic, payload) => {
        if (!topic.includes("mx/symbol")) {
          return;
        }

        try {
          const decoded = this.symbolMessage.decode(payload);
          if (decoded.symbolCode !== this.xu100Code) {
            return;
          }

          const data = {
            symbolCode: decoded.symbolCode,
            updateDate: decoded.updateDate || null,
            last: decoded.last ?? null,
            dayClose: decoded.dayClose ?? null,
            bid: decoded.bid ?? null,
            ask: decoded.ask ?? null,
            low: decoded.low ?? null,
            high: decoded.high ?? null,
            open: decoded.open ?? null,
            quantity: decoded.quantity ?? null,
            volume: decoded.volume ?? null,
            raw: decoded,
          };

          for (const handler of this.spotHandlers) {
            handler(data);
          }
        } catch (error) {
          console.error("XU100 decode hatasi:", error.message);
        }
      });

      client.on("error", (error) => {
        if (!settled) {
          settled = true;
          reject(error);
        } else {
          console.error("XU100 socket hatasi:", error.message);
        }
      });
    });
  }

  _connectViop() {
    console.log("[LIVEMARKETSTREAM _connectViop ENTERED]");

    return new Promise((resolve, reject) => {
      const client = mqtt.connect(
        "wss://rttest.radix.matriksdata.com:443/market",
        this.options
      );

      this.viopClient = client;
      let settled = false;

      client.on("connect", () => {
        client.subscribe(`mx/derivative/${this.viopCode}`, (error, granted) => {
          if (error) {
            if (!settled) {
              settled = true;
              reject(error);
            }
            return;
          }

          if (!granted || !granted.length) {
            if (!settled) {
              settled = true;
              reject(new Error("VIOP subscribe onayi alinmadi."));
            }
            return;
          }

          if (!settled) {
            settled = true;
            resolve();
          }
        });
      });

      client.on("message", (topic, payload) => {
        console.log("[VIOP MESSAGE FIRED]", topic, payload?.length);

        if (!topic.includes("mx/derivative")) {
          return;
        }

        try {
          console.log("[VIOP TOPIC]", topic);
          console.log("[VIOP PAYLOAD LEN]", payload.length);

          console.log("[BEFORE VIOP DECODE]", topic, payload?.length);
          const decoded = this.derivativeMessage.decode(payload);
          console.log("[AFTER VIOP DECODE]", decoded);
          console.log("[VIOP DECODED]", decoded);

          const objectified = this.derivativeMessage.toObject(decoded, {
            longs: Number,
            enums: String,
            defaults: false,
            arrays: true,
            objects: true,
          });

          console.log("[VIOP RAW DECODED]", decoded);
          console.log("[VIOP OBJECTIFIED]", objectified);
          console.log("[VIOP LAST]", decoded.last);
          console.log("[VIOP DAYCLOSE]", decoded.dayClose);

          if (decoded.symbolCode !== this.viopCode) {
            return;
          }

          const data = {
            symbolCode: decoded.symbolCode,
            updateDate: decoded.updateDate || null,
            last: decoded.last ?? null,
            dayClose: decoded.dayClose ?? null,
            bid: decoded.bid ?? null,
            ask: decoded.ask ?? null,
            low: decoded.low ?? null,
            high: decoded.high ?? null,
            open: decoded.open ?? null,
            quantity: decoded.quantity ?? null,
            volume: decoded.volume ?? null,
            initialMargin: decoded.initialMargin ?? null,
            raw: decoded,
          };

          for (const handler of this.viopHandlers) {
            handler(data);
          }
        } catch (error) {
          console.error("VIOP decode hatasi:", error.message);
        }
      });

      client.on("error", (error) => {
        if (!settled) {
          settled = true;
          reject(error);
        } else {
          console.error("VIOP socket hatasi:", error.message);
        }
      });
    });
  }
}

module.exports = {
  LiveMarketStream,
};
