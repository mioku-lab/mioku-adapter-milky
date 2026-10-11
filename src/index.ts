export { milkyAdapterDefinition, MILKY_PROTOCOL_VERSION } from "./adapter";
export * from "./bot";
export * from "./client";
export * from "./config";
export * from "./event";
export * from "./gateway";
export * from "./message";
export * from "./status";
export * from "./types";
export { milkyAdapterDefinition as default } from "./adapter";

declare module "mioku" {
  interface AdapterBotMap {
    milky: import("./bot").MilkyBot;
  }
}
