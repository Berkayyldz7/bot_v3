const mqtt = require("mqtt");
const pb = require("protobufjs");
const dotenv = require("dotenv");
const path = require("path");

dotenv.config({
  path: path.resolve(__dirname, "../.env"),
});

const symbolMessage = pb
  .loadSync(path.resolve(__dirname, "./proto/Symbol.proto"))
  .lookupType("messages.SymbolMessage");

const derivativeMessage = pb
  .loadSync(path.resolve(__dirname, "./proto/Derivative.proto"))
  .lookupType("messages.DerivativeMessage");

const state = {
  bist: null,
  bistTime: null,
  fxu: null,
  fxuTime: null,
};

const options = {
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

function isFresh(ts, maxAgeMs = 10000) {
  if (!ts) return false;
  return Date.now() - ts < maxAgeMs;
}

const bistClient = mqtt.connect("wss://dltest.radix.matriksdata.com:443/market", options);
const fxuClient = mqtt.connect("wss://rttest.radix.matriksdata.com:443/market", options);

bistClient.on("connect", () => {
  console.log("BIST socket baglandi");

  bistClient.subscribe("mx/symbol/XU100@lvl2", (error) => {
    if (error) {
      console.error("BIST subscribe hatasi:", error.message);
    }
  });
});

fxuClient.on("connect", () => {
  console.log("FXU socket baglandi");

  fxuClient.subscribe(`mx/derivative/${process.env.VIOP_SOZLESME}`, (error) => {
    if (error) {
      console.error("FXU subscribe hatasi:", error.message);
    }
  });
});

bistClient.on("message", (topic, payload) => {
  try {
    const decoded = symbolMessage.decode(payload);

    state.bist = symbolMessage.toObject(decoded, {
      longs: Number,
      enums: String,
      defaults: true,
    });

    state.bistTime = Date.now();
  } catch (error) {
    console.error("BIST decode hatasi:", error.message);
  }
});

fxuClient.on("message", (topic, payload) => {
  try {
    const decoded = derivativeMessage.decode(payload);

    state.fxu = derivativeMessage.toObject(decoded, {
      longs: Number,
      enums: String,
      defaults: true,
    });

    state.fxuTime = Date.now();
  } catch (error) {
    console.error("FXU decode hatasi:", error.message);
  }
});

bistClient.on("error", (error) => {
  console.error("BIST socket hatasi:", error.message);
});

fxuClient.on("error", (error) => {
  console.error("FXU socket hatasi:", error.message);
});

setInterval(() => {
  if (!state.bist || !state.fxu) {
    return;
  }

  const bistLive = isFresh(state.bistTime);
  const fxuLive = isFresh(state.fxuTime);

  if (!bistLive || !fxuLive) {
    return;
  }

  console.log("BIST snapshot:", state.bist);
  console.log("FXU snapshot:", state.fxu);
}, 1000);
