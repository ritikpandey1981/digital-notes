export type DomainId = string;

export type IsoTimestamp = string;

export type JsonPrimitive = boolean | null | number | string;

export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[];

export type JsonObject = Readonly<{
  [key: string]: JsonValue;
}>;

export interface Position {
  readonly x: number;
  readonly y: number;
}
